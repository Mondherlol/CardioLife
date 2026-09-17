const path     = require('path')
const os       = require('os')
const fs       = require('fs')
const fsp      = require('fs/promises')
const crypto   = require('crypto')
const readline = require('readline')
const { Readable, pipeline } = require('stream')
const multer   = require('multer')
const archiver = require('archiver')
const yauzl    = require('yauzl')
const mongoose = require('mongoose')

const { EJSON } = mongoose.mongo.BSON

/* ── Sauvegarde complète ──────────────────────────────────────────
   Une archive = toute la base + tous les fichiers téléversés :

     manifest.json             format, date, nombre de documents par collection
     db/<collection>.ndjson    un document par ligne, en EJSON canonique
     uploads/…                 copie conforme du dossier uploads

   EJSON canonique plutôt que JSON : les ObjectId, dates et nombres gardent
   leur type exact, la restauration réinsère les documents tels quels.
   Tout est écrit et relu en flux — les uploads pèsent des centaines de Mo,
   les charger en mémoire ferait tomber le conteneur. */

const UPLOADS_DIR    = path.join(__dirname, '..', 'uploads')
const BACKUP_APP     = 'cardiotrack'
const BACKUP_VERSION = 1
const INSERT_BATCH   = 500

// Dossier de travail de la restauration. Il vit dans `uploads` — le volume
// Docker — pour que le remplacement final soit un simple `rename`, impossible
// entre deux systèmes de fichiers.
const RESTORE_PREFIX = '.restore-'

async function listCollections() {
  const cols = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
  return cols
    .filter(c => c.type !== 'view' && !c.name.startsWith('system.'))
    .map(c => c.name)
    .sort()
}

function stamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `_${pad(date.getHours())}h${pad(date.getMinutes())}`
}

/** GET /api/app-settings/backup — télécharge l'archive complète. */
async function download(req, res) {
  const db = mongoose.connection.db
  const collections = await listCollections()

  const counts = {}
  for (const name of collections) counts[name] = await db.collection(name).countDocuments()

  const manifest = {
    app:        BACKUP_APP,
    version:    BACKUP_VERSION,
    createdAt:  new Date().toISOString(),
    createdBy:  req.user.username,
    database:   mongoose.connection.name,
    collections: counts,
  }

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="cardiotrack-backup_${stamp()}.zip"`)

  // Les images et PDF sont déjà compressés : un niveau bas va bien plus vite
  // pour un gain de taille quasi nul.
  const archive = archiver('zip', { zlib: { level: 1 } })
  archive.on('warning', err => console.warn('[BACKUP]', err.message))
  pipeline(archive, res, err => {
    if (err) console.error('[BACKUP] Archive interrompue :', err.message)
  })

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

  for (const name of collections) {
    // Le curseur ne s'ouvre qu'au moment où archiver lit l'entrée : une seule
    // collection est parcourue à la fois.
    async function* lines() {
      for await (const doc of db.collection(name).find({})) {
        yield EJSON.stringify(doc, { relaxed: false }) + '\n'
      }
    }
    archive.append(Readable.from(lines()), { name: `db/${name}.ndjson` })
  }

  archive.glob('**/*', {
    cwd: UPLOADS_DIR,
    dot: true,
    ignore: [`${RESTORE_PREFIX}*/**`, `${RESTORE_PREFIX}*`],
  }, { prefix: 'uploads' })

  await archive.finalize()
  console.warn(`[BACKUP] Sauvegarde téléchargée par ${req.user.username} (${req.user._id})`)
}

/* ── Restauration ──────────────────────────────────────────────── */

const uploadBackup = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, _file, cb) => cb(null, `cardiotrack-restore-${crypto.randomUUID()}.zip`),
  }),
  fileFilter: (_req, file, cb) => {
    const ok = /\.zip$/i.test(file.originalname)
    cb(ok ? null : new Error('Le fichier doit être une archive .zip.'), ok)
  },
}).single('backup')

/** Dézippe `zipPath` dans `destDir`, en refusant tout chemin qui en sortirait. */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new Error("Archive illisible — ce n'est pas un zip valide."))

      const fail = e => { zip.close(); reject(e) }
      zip.on('error', fail)
      zip.on('end', resolve)
      zip.on('entry', entry => {
        const target = path.resolve(destDir, entry.fileName)
        if (target !== destDir && !target.startsWith(destDir + path.sep)) {
          return fail(new Error(`Chemin interdit dans l'archive : ${entry.fileName}`))
        }
        if (/\/$/.test(entry.fileName)) {
          fsp.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail)
          return
        }
        fsp.mkdir(path.dirname(target), { recursive: true })
          .then(() => zip.openReadStream(entry, (e, stream) => {
            if (e) return fail(e)
            pipeline(stream, fs.createWriteStream(target), e2 => (e2 ? fail(e2) : zip.readEntry()))
          }), fail)
      })
      zip.readEntry()
    })
  })
}

async function readManifest(dir) {
  const raw = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => null)
  if (!raw) throw new Error("Ce zip n'est pas une sauvegarde CardioTrack (manifest.json absent).")
  let manifest
  try { manifest = JSON.parse(raw) } catch { throw new Error('manifest.json illisible.') }
  if (manifest.app !== BACKUP_APP) throw new Error("Ce zip n'est pas une sauvegarde CardioTrack.")
  if (manifest.version > BACKUP_VERSION) {
    throw new Error('Sauvegarde produite par une version plus récente de CardioTrack.')
  }
  return manifest
}

async function importCollection(db, name, file) {
  const col = db.collection(name)
  const rl  = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  let batch = []
  let total = 0
  for await (const line of rl) {
    if (!line.trim()) continue
    batch.push(EJSON.parse(line, { relaxed: false }))
    if (batch.length >= INSERT_BATCH) {
      await col.insertMany(batch, { ordered: false })
      total += batch.length
      batch = []
    }
  }
  if (batch.length) {
    await col.insertMany(batch, { ordered: false })
    total += batch.length
  }
  return total
}

/**
 * POST /api/app-settings/backup/restore — remplace TOUT par le contenu du zip :
 * base (comptes compris) et fichiers.
 *
 * L'archive est entièrement dézippée et validée avant d'effacer quoi que ce
 * soit : un zip corrompu ou étranger est refusé sans dégât. Passé ce point,
 * il n'y a pas de transaction (Mongo en instance seule) — d'où la phrase de
 * confirmation et le conseil de télécharger une sauvegarde juste avant.
 */
async function restore(req, res) {
  const zipPath = req.file?.path
  if (!zipPath) return res.status(400).json({ message: 'Aucune archive reçue.' })

  const workDir = path.join(UPLOADS_DIR, `${RESTORE_PREFIX}${crypto.randomUUID()}`)
  try {
    if (String(req.body?.confirm || '').trim().toUpperCase() !== 'RESTAURER') {
      return res.status(422).json({ message: 'Confirmation manquante.' })
    }

    await fsp.mkdir(workDir, { recursive: true })
    try {
      await extractZip(zipPath, workDir)
    } catch (err) {
      return res.status(422).json({ message: err.message })
    }

    let manifest
    try {
      manifest = await readManifest(workDir)
    } catch (err) {
      return res.status(422).json({ message: err.message })
    }

    const dbDir = path.join(workDir, 'db')
    const files = (await fsp.readdir(dbDir).catch(() => []))
      .filter(f => f.endsWith('.ndjson'))
    if (!files.length) {
      return res.status(422).json({ message: 'La sauvegarde ne contient aucune donnée.' })
    }

    // ── Point de non-retour ──
    const db = mongoose.connection.db
    for (const name of await listCollections()) {
      await db.collection(name).deleteMany({})
    }
    const restored = {}
    for (const file of files) {
      const name = file.replace(/\.ndjson$/, '')
      restored[name] = await importCollection(db, name, path.join(dbDir, file))
    }

    // Fichiers : on vide `uploads` (sauf le dossier de travail) puis on y
    // déplace ceux de l'archive.
    for (const entry of await fsp.readdir(UPLOADS_DIR)) {
      if (entry.startsWith(RESTORE_PREFIX)) continue
      await fsp.rm(path.join(UPLOADS_DIR, entry), { recursive: true, force: true })
    }
    const srcUploads = path.join(workDir, 'uploads')
    for (const entry of await fsp.readdir(srcUploads).catch(() => [])) {
      await fsp.rename(path.join(srcUploads, entry), path.join(UPLOADS_DIR, entry))
    }
    // Les dossiers attendus par les middlewares d'upload doivent exister même
    // si la sauvegarde n'en contenait pas.
    for (const dir of ['avatars', 'clients', 'company', 'documents', 'formations', 'interventions', 'products']) {
      await fsp.mkdir(path.join(UPLOADS_DIR, dir), { recursive: true })
    }

    console.warn(`[RESTORE] Sauvegarde du ${manifest.createdAt} restaurée par `
      + `${req.user.username} (${req.user._id})`, JSON.stringify(restored))

    res.json({
      message: 'Sauvegarde restaurée.',
      backupDate: manifest.createdAt,
      restored,
    })
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {})
    await fsp.rm(zipPath, { force: true }).catch(() => {})
  }
}

module.exports = { download, uploadBackup, restore }
