const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')
const AdmZip  = require('adm-zip')
const Product = require('../models/Product')

/**
 * Export / import des visuels du catalogue, en une archive ZIP.
 *
 * Les images ne tiennent pas dans une cellule Excel : elles voyagent à part,
 * dans une archive dont chaque dossier porte le nom d'un produit. C'est ce nom
 * de dossier qui fait le lien au retour — la référence si elle existe, le nom
 * du modèle sinon, exactement la règle du classeur.
 *
 *   catalogue-images/
 *     LISEZ-MOI.txt
 *     ZOLL AED 3 (Automatique)/
 *       01-zoll-aed-3.jpg
 *       02-zoll-aed-3-face.jpg
 *
 * Rien n'oblige à repartir de l'export : un dossier créé à la main, nommé comme
 * le produit, est repris tel quel. C'est le cas courant — on a les photos, on
 * n'a pas encore le catalogue.
 */

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products')
const IMAGE_EXT  = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']
const MAX_ZIP    = 200 * 1024 * 1024      // 200 Mo

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_ZIP },
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.match(/\.zip$/i) || file.mimetype.includes('zip')
    cb(null, !!ok)
  },
}).single('file')

/* ── Nommage ──────────────────────────────────────────────────── */

function normalizeText(str) {
  return String(str ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/** Nom de dossier lisible : ni séparateur de chemin, ni caractère interdit. */
function folderName(product) {
  const base = product.reference?.trim() || product.name?.trim() || String(product._id)
  return base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Extension d'image, ou null si le fichier n'en est pas une. */
function imageExt(name) {
  const ext = path.extname(name).toLowerCase()
  return IMAGE_EXT.includes(ext) ? ext : null
}

/* ── Export ───────────────────────────────────────────────────── */

const README = `Images du catalogue CardioTrack
================================

Un dossier par produit. Le nom du dossier identifie le produit au réimport :
c'est sa référence si elle est renseignée, son nom sinon — la même règle que
le classeur Excel.

Pour ajouter des visuels :
  1. créez ou complétez le dossier du produit ;
  2. déposez-y vos images (.jpg, .png, .webp, .gif, .avif) ;
  3. rezippez le tout et réimportez-le depuis Stock › Import / export.

L'ordre d'affichage suit l'ordre alphabétique des fichiers : préfixez-les
01-, 02-… pour le maîtriser. La première image est la vignette du produit.

Un dossier dont le nom ne correspond à aucun produit est signalé et ignoré :
rien n'est créé à l'aveugle.
`

async function exportZip(req, res) {
  const { category, archived = 'false' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  if (category) filter.category = category

  const products = await Product.find(filter).sort({ name: 1 }).select('name reference images').lean()

  const zip = new AdmZip()
  zip.addFile('catalogue-images/LISEZ-MOI.txt', Buffer.from(README, 'utf8'))

  let files = 0, missing = 0
  const used = new Map()

  for (const p of products) {
    if (!p.images?.length) continue

    /* Deux produits peuvent porter le même nom : un suffixe évite qu'un dossier
       n'écrase l'autre dans l'archive. */
    let dir = folderName(p)
    const seen = used.get(normalizeText(dir)) || 0
    used.set(normalizeText(dir), seen + 1)
    if (seen) dir = `${dir} (${seen + 1})`

    p.images.forEach((filename, i) => {
      const full = path.join(UPLOAD_DIR, path.basename(filename))
      if (!fs.existsSync(full)) { missing++; return }
      const ext = path.extname(filename) || '.jpg'
      zip.addLocalFile(full, `catalogue-images/${dir}`, `${String(i + 1).padStart(2, '0')}${ext}`)
      files++
    })
  }

  if (files === 0) {
    return res.status(404).json({
      message: missing
        ? `Aucun fichier image retrouvé sur le serveur (${missing} référencé(s) mais absent(s)).`
        : 'Aucun produit du catalogue ne porte d\'image.',
    })
  }

  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="catalogue_images_${stamp}.zip"`)
  res.setHeader('X-Image-Count', String(files))
  res.send(zip.toBuffer())
}

/* ── Import ───────────────────────────────────────────────────── */

/** Produit désigné par un nom de dossier : la référence d'abord, le nom ensuite. */
function matchProduct(dir, products) {
  // Le suffixe « (2) » ajouté à l'export pour départager deux homonymes.
  const clean = dir.replace(/\s*\(\d+\)$/, '').trim()
  const key   = normalizeText(clean)
  return products.find(p => p.reference && normalizeText(p.reference) === key)
      || products.find(p => normalizeText(p.name) === key)
      || null
}

/**
 * Reprend les images d'une archive.
 *
 * `mode=remplacer` repart de zéro pour les produits présents dans l'archive ;
 * par défaut on ajoute à ce qui existe déjà — on n'efface pas un visuel que
 * personne n'a demandé à retirer.
 */
function importZip(req, res) {
  upload(req, res, async err => {
    if (err) return res.status(400).json({ message: err.message })
    if (!req.file) return res.status(400).json({ message: 'Aucune archive reçue.' })

    const replace = String(req.body?.mode || '').startsWith('remplac')

    let entries
    try {
      entries = new AdmZip(req.file.buffer).getEntries()
    } catch {
      return res.status(400).json({ message: 'Archive illisible — vérifiez qu\'il s\'agit bien d\'un .zip.' })
    }

    /* Un dossier par produit. La racine « catalogue-images/ » de notre propre
       export est traversée sans façon : elle n'identifie rien. */
    const byFolder = new Map()
    for (const e of entries) {
      if (e.isDirectory) continue
      const parts = e.entryName.split('/').filter(Boolean)
      if (parts.length < 2) continue                       // fichier à la racine

      const file = parts[parts.length - 1]
      if (file.startsWith('.') || file.startsWith('__MACOSX')) continue
      if (!imageExt(file)) continue

      const dir = parts[parts.length - 2]
      if (!byFolder.has(dir)) byFolder.set(dir, [])
      byFolder.get(dir).push(e)
    }

    if (byFolder.size === 0) {
      return res.status(400).json({
        message: 'Aucune image trouvée. Attendu : un dossier par produit, contenant ses images.',
      })
    }

    const products = await Product.find({}).select('name reference images').lean()
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })

    const results = []
    let added = 0

    for (const [dir, files] of byFolder) {
      const product = matchProduct(dir, products)
      if (!product) {
        results.push({ folder: dir, success: false, count: files.length, error: 'Aucun produit de ce nom ni de cette référence' })
        continue
      }

      try {
        // Ordre du dossier = ordre d'affichage : la première image est la vignette.
        files.sort((a, b) => a.entryName.localeCompare(b.entryName, 'fr', { numeric: true }))

        const written = []
        for (const e of files) {
          const ext  = imageExt(e.entryName)
          const name = `${product._id}-${Date.now()}-${written.length}${ext}`
          fs.writeFileSync(path.join(UPLOAD_DIR, name), e.getData())
          written.push(name)
        }

        const before = replace ? [] : (product.images || [])
        await Product.updateOne({ _id: product._id }, { $set: { images: [...before, ...written] } })

        // Les fichiers remplacés ne servent plus à personne : on ne laisse pas
        // le dossier d'upload gonfler à chaque reprise.
        if (replace) {
          for (const old of product.images || []) {
            fs.unlink(path.join(UPLOAD_DIR, path.basename(old)), () => {})
          }
        }

        added += written.length
        results.push({
          folder: dir, success: true, product: product.name,
          count: written.length, mode: replace ? 'remplacées' : 'ajoutées',
          total: before.length + written.length,
        })
      } catch (e) {
        results.push({ folder: dir, success: false, count: files.length, error: e.message })
      }
    }

    res.json({
      results: results.sort((a, b) => Number(a.success) - Number(b.success)),
      summary: {
        folders:  byFolder.size,
        matched:  results.filter(r => r.success).length,
        unmatched: results.filter(r => !r.success).length,
        images:   added,
        replace,
      },
    })
  })
}

module.exports = { exportZip, importZip }
