const multer          = require('multer')
const XLSX            = require('xlsx')
const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')
const ProductItem     = require('../models/ProductItem')
const StockMovement   = require('../models/StockMovement')

/**
 * Import / export Excel du catalogue produits.
 *
 * Une ligne = un modèle. Le fichier exporté se réimporte tel quel : les mêmes
 * en-têtes servent dans les deux sens, si bien qu'on exporte, on corrige dans
 * Excel, et on réimporte pour mettre à jour.
 *
 * Le rapprochement se fait sur la référence quand elle est renseignée, sur le
 * nom sinon : un modèle déjà au catalogue est mis à jour, jamais dupliqué.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
               file.mimetype.includes('excel') ||
               file.originalname.match(/\.(xlsx|xls|csv)$/i)
    cb(null, !!ok)
  },
}).single('file')

/* ── En-tête Excel → clé interne ──────────────────────────────── */

const COL_MAP = {
  'nom':                       'name',
  'nom du produit':            'name',
  'produit':                   'name',
  'modele':                    'name',
  'name':                      'name',

  'categorie':                 'category',
  'category':                  'category',
  'famille':                   'category',

  'reference':                 'reference',
  'ref':                       'reference',

  'marque':                    'brand',
  'brand':                     'brand',
  'fabricant':                 'brand',

  'mode':                      'deviceMode',
  'mode de fonctionnement':    'deviceMode',
  'type de dea':               'deviceMode',

  'numero de serie requis':    'requiresSerialNumber',
  'suivi par numero de serie': 'requiresSerialNumber',
  'serialise':                 'requiresSerialNumber',

  'numero de lot requis':      'requiresLotNumber',
  'suivi par lot':             'requiresLotNumber',

  'stock':                     'stock',
  'quantite':                  'stock',
  'quantite en stock':         'stock',

  'seuil d alerte':            'alertThreshold',
  'seuil alerte':              'alertThreshold',

  'prix d achat':              'purchasePrice',
  'prix achat':                'purchasePrice',
  'prix de vente':             'salePrice',
  'prix vente':                'salePrice',

  'fournisseur':               'supplier',
  'supplier':                  'supplier',

  'description':               'description',
  'notes':                     'notes',
  'remarques':                 'notes',

  'visible sur le site':       'listedOnWebsite',
  'site web':                  'listedOnWebsite',
}

/* Ordre des colonnes de l'export et du modèle vierge : ce sont aussi les
   en-têtes que l'import reconnaît, l'aller-retour est donc sans perte. */
const EXPORT_COLUMNS = [
  { header: 'Nom',                    key: 'name' },
  { header: 'Catégorie',              key: 'category' },
  { header: 'Référence',              key: 'reference' },
  { header: 'Marque',                 key: 'brand' },
  { header: 'Mode',                   key: 'deviceMode' },
  { header: 'Numéro de série requis', key: 'requiresSerialNumber' },
  { header: 'Numéro de lot requis',   key: 'requiresLotNumber' },
  { header: 'Stock',                  key: 'stock' },
  { header: "Seuil d'alerte",         key: 'alertThreshold' },
  { header: "Prix d'achat",           key: 'purchasePrice' },
  { header: 'Prix de vente',          key: 'salePrice' },
  { header: 'Fournisseur',            key: 'supplier' },
  { header: 'Description',            key: 'description' },
  { header: 'Notes',                  key: 'notes' },
]

/* ── Petits convertisseurs ────────────────────────────────────── */

function normalizeText(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/** En-tête ramené à sa forme canonique : sans accent ni ponctuation. */
function normalizeHeader(h) {
  return normalizeText(h).replace(/[°.'’_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function exactRe(value) {
  return { $regex: `^${escapeRegex(String(value).trim())}$`, $options: 'i' }
}

/** Booléen tolérant : « oui », « x », « 1 »… Vide → undefined (on n'écrase rien). */
function toBool(value) {
  const v = normalizeText(value)
  if (!v) return undefined
  if (['oui', 'yes', 'true', 'vrai', '1', 'x'].includes(v)) return true
  if (['non', 'no', 'false', 'faux', '0'].includes(v)) return false
  return null   // valeur non reconnue
}

/** Nombre tolérant : accepte la virgule décimale et les espaces de milliers. */
function toNumber(value) {
  if (value === '' || value == null) return undefined
  const str = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')
  if (!str) return undefined
  const n = Number(str)
  return Number.isFinite(n) ? n : null
}

function toMode(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (v.startsWith('semi')) return 'semi-automatique'
  if (v.startsWith('auto') || v === 'entierement automatique') return 'automatique'
  return null
}

/* ── Lecture de la feuille ────────────────────────────────────── */

function parseSheet(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (raw.length < 2) return { headers: [], rows: [] }

  const headers = raw[0].map(normalizeHeader)
  const rows = raw.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, i) => {
      const key = COL_MAP[h]
      if (!key) return
      obj[key] = String(r[i] ?? '').trim()
    })
    return obj
  }).filter(r => Object.values(r).some(v => v !== ''))

  return { headers, rows }
}

/* ── Validation d'une ligne ───────────────────────────────────── */

function normalizeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) out[k] = String(v ?? '').trim()
  return out
}

const NUMBER_FIELDS = [
  ['stock',          'Stock'],
  ['alertThreshold', "Seuil d'alerte"],
  ['purchasePrice',  "Prix d'achat"],
  ['salePrice',      'Prix de vente'],
]

const BOOL_FIELDS = [
  ['requiresSerialNumber', 'Numéro de série requis'],
  ['requiresLotNumber',    'Numéro de lot requis'],
  ['listedOnWebsite',      'Visible sur le site'],
]

/** Catégorie désignée par son nom ou son slug, sans souci de casse ni d'accent. */
function findCategory(categories, label) {
  const v = normalizeText(label)
  if (!v) return null
  return categories.find(c => normalizeText(c.slug) === v || normalizeText(c.name) === v) || null
}

function validateRow(row, idx, { categories }) {
  const r      = normalizeRow(row)
  const errors = []

  if (!r.name) errors.push('Nom du produit obligatoire')

  /* La catégorie doit exister : en créer une à la volée depuis un tableur
     laisserait son paramétrage (icône, couleur, suivi) au hasard. */
  let category = null
  if (!r.category) {
    errors.push('Catégorie obligatoire')
  } else {
    category = findCategory(categories, r.category)
    if (!category) {
      errors.push(`Catégorie inconnue : « ${r.category} » — attendu : ${categories.map(c => c.name).join(', ')}`)
    }
  }

  for (const [key, label] of NUMBER_FIELDS) {
    if (!r[key]) continue
    const n = toNumber(r[key])
    if (n === null)   errors.push(`${label} illisible : ${r[key]}`)
    else if (n < 0)   errors.push(`${label} négatif : ${r[key]}`)
  }

  for (const [key, label] of BOOL_FIELDS) {
    if (r[key] && toBool(r[key]) === null) {
      errors.push(`${label} : valeur inconnue « ${r[key]} » (attendu « oui » ou « non »)`)
    }
  }

  if (toMode(r.deviceMode) === null) {
    errors.push(`Mode inconnu : « ${r.deviceMode} » (attendu « automatique » ou « semi-automatique »)`)
  }

  return {
    row: r,
    rowNum: idx + 2,
    errors,
    // Non bloquants : signalés dans l'aperçu, ils n'empêchent pas l'import.
    warnings: [],
    valid: errors.length === 0,
    categoryName: category?.name || r.category,
  }
}

/* ── Validation du fichier ────────────────────────────────────── */

function validate(req, res) {
  upload(req, res, async err => {
    if (err) return res.status(400).json({ message: err.message })
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })

    let rows, headers
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
      ;({ rows, headers } = parseSheet(wb))
    } catch {
      return res.status(400).json({
        message: "Fichier illisible — vérifiez qu'il s'agit bien d'un classeur Excel.",
      })
    }

    if (rows.length === 0) {
      return res.status(400).json({
        message: 'Aucune ligne exploitable. Au minimum, une colonne « Nom » et une colonne « Catégorie ».',
      })
    }

    const categories = await ProductCategory.find({ isActive: true }).select('name slug').lean()
    const results    = rows.map((r, i) => validateRow(r, i, { categories }))

    /* Ce que l'import fera de chaque ligne : créer, ou mettre à jour un modèle
       déjà au catalogue. Le rapprochement suit la règle de l'exécution. */
    const seen = new Map()
    for (const r of results) {
      if (!r.valid) continue

      const existing = await findProduct(r.row)
      r.action = existing ? 'update' : 'create'
      if (existing) r.warnings.push('Déjà au catalogue — la fiche sera mise à jour')

      // Doublon interne au fichier : la dernière ligne écraserait la précédente.
      const key = matchKey(r.row)
      if (seen.has(key)) r.warnings.push(`Doublon de la ligne ${seen.get(key)} de ce fichier`)
      else seen.set(key, r.rowNum)

      if (r.action === 'update' && r.row.stock) {
        r.warnings.push("Stock ignoré : la quantité d'un produit existant se règle depuis le stock")
      }
    }

    const valid = results.filter(r => r.valid)
    res.json({
      headers,
      categories: categories.map(c => c.name),
      results,
      summary: {
        total:    rows.length,
        valid:    valid.length,
        invalid:  results.length - valid.length,
        created:  valid.filter(r => r.action === 'create').length,
        updated:  valid.filter(r => r.action === 'update').length,
        warnings: results.filter(r => r.warnings.length > 0).length,
      },
    })
  })
}

/* ── Import réel ──────────────────────────────────────────────── */

/** Clé de rapprochement : la référence prime, le nom sert de repli. */
function matchKey(row) {
  return row.reference ? `ref:${normalizeText(row.reference)}` : `nom:${normalizeText(row.name)}`
}

/** Modèle déjà au catalogue correspondant à la ligne, ou null. */
function findProduct(row) {
  if (row.reference) return Product.findOne({ reference: exactRe(row.reference) })
  return Product.findOne({ name: exactRe(row.name) })
}

/** Champs à écrire : une colonne vide ne remet rien à zéro. */
function buildPatch(row, categorySlug) {
  const set = { name: row.name, category: categorySlug }

  for (const key of ['reference', 'brand', 'supplier', 'description', 'notes']) {
    if (row[key]) set[key] = row[key]
  }

  const mode = toMode(row.deviceMode)
  if (mode) set.deviceMode = mode

  for (const [key] of BOOL_FIELDS) {
    const b = toBool(row[key])
    if (b !== undefined && b !== null) set[key] = b
  }

  for (const key of ['alertThreshold', 'purchasePrice', 'salePrice']) {
    const n = toNumber(row[key])
    if (n !== undefined && n !== null) set[key] = n
  }

  return set
}

async function execute(req, res) {
  const { rows } = req.body
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne à importer.' })
  }

  const categories = await ProductCategory.find({ isActive: true }).select('name slug').lean()
  const results    = []

  for (const raw of rows) {
    const row = normalizeRow(raw)
    if (!row.name) continue

    try {
      const category = findCategory(categories, row.category)
      if (!category) throw new Error(`Catégorie inconnue : ${row.category}`)

      const patch   = buildPatch(row, category.slug)
      let   product = await findProduct(row)
      const created = !product

      if (product) {
        // Mise à jour non destructive : le stock reste géré par les articles.
        product.set(patch)
        await product.save()
      } else {
        const stock = toNumber(row.stock) || 0
        product = await Product.create({ ...patch, stock, createdBy: req.user._id })

        // Un stock initial doit exister côté articles, sinon la fiche produit
        // afficherait un total sans aucun exemplaire derrière.
        if (stock > 0) {
          const movement = await StockMovement.create({
            product:       product._id,
            type:          'entree',
            quantity:      stock,
            previousStock: 0,
            newStock:      stock,
            reason:        'Stock initial — import Excel',
            createdBy:     req.user._id,
          })
          await ProductItem.create({
            product:       product._id,
            category:      product.category,
            reference:     product.reference || '',
            supplier:      product.supplier  || '',
            quantity:      stock,
            status:        'disponible',
            entryMovement: movement._id,
            createdBy:     req.user._id,
            history:       [{ action: 'Stock initial — import Excel', to: 'disponible', user: req.user._id }],
          })
        }
      }

      results.push({
        name:     product.name,
        category: category.name,
        success:  true,
        id:       product._id,
        action:   created ? 'created' : 'updated',
      })
    } catch (err) {
      results.push({ name: row.name, category: row.category, success: false, error: err.message })
    }
  }

  res.json({
    results,
    summary: {
      imported: results.filter(r => r.success).length,
      created:  results.filter(r => r.action === 'created').length,
      updated:  results.filter(r => r.action === 'updated').length,
      failed:   results.filter(r => !r.success).length,
    },
  })
}

/* ── Export ───────────────────────────────────────────────────── */

const yesNo = v => (v ? 'oui' : 'non')

/**
 * Catalogue au format du modèle d'import : le fichier téléchargé se corrige
 * dans Excel puis se réimporte pour mettre à jour les fiches.
 */
async function exportAll(req, res) {
  const { category, archived = 'false' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  if (category) filter.category = category

  const [products, categories] = await Promise.all([
    Product.find(filter).sort({ category: 1, name: 1 }).lean(),
    ProductCategory.find().select('name slug').lean(),
  ])
  const catName = Object.fromEntries(categories.map(c => [c.slug, c.name]))

  const rows = products.map(p => ({
    name:                 p.name || '',
    category:             catName[p.category] || p.category || '',
    reference:            p.reference || '',
    brand:                p.brand || '',
    deviceMode:           p.deviceMode || '',
    requiresSerialNumber: yesNo(p.requiresSerialNumber),
    requiresLotNumber:    yesNo(p.requiresLotNumber),
    stock:                p.stock ?? 0,
    alertThreshold:       p.alertThreshold ?? '',
    purchasePrice:        p.purchasePrice ?? '',
    salePrice:            p.salePrice ?? '',
    supplier:             p.supplier || '',
    description:          p.description || '',
    notes:                p.notes || '',
  }))

  res.json({ columns: EXPORT_COLUMNS, rows, total: rows.length })
}

module.exports = { validate, execute, exportAll, EXPORT_COLUMNS }
