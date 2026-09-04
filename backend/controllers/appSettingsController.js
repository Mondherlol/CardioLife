const path   = require('path')
const fs     = require('fs')
const fsp    = require('fs/promises')
const crypto = require('crypto')
const multer = require('multer')
const AppSettings = require('../models/AppSettings')

/* Le logo vit avec les autres uploads : il doit survivre à un redéploiement du
   code, ce qui exclut de l'écrire dans les fichiers statiques du front. */
const LOGO_DIR = path.join(__dirname, '../uploads/company')
fs.mkdirSync(LOGO_DIR, { recursive: true })

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

const uploadLogo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGO_DIR),
    filename:    (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(
    LOGO_TYPES.includes(file.mimetype) ? null : new Error("Format d'image non supporté."),
    LOGO_TYPES.includes(file.mimetype),
  ),
}).single('logo')

/* Champs libres de l'identité — le logo passe par sa propre route (fichier). */
const COMPANY_FIELDS = ['name', 'address', 'city', 'phone', 'email', 'website', 'taxId', 'footer']

async function get(req, res) {
  const settings = await AppSettings.findOne() ?? await AppSettings.create({})
  res.json(settings)
}

async function update(req, res) {
  const { maxFileSizeMB, maxTotalSpaceMB, defaultUploadFolderId, company } = req.body
  let settings = await AppSettings.findOne()
  if (!settings) settings = new AppSettings()
  if (maxFileSizeMB   != null) settings.maxFileSizeMB   = Number(maxFileSizeMB)
  if (maxTotalSpaceMB != null) settings.maxTotalSpaceMB = Number(maxTotalSpaceMB)
  if (defaultUploadFolderId !== undefined) settings.defaultUploadFolderId = defaultUploadFolderId || null
  if (company && typeof company === 'object') {
    for (const key of COMPANY_FIELDS) {
      if (company[key] !== undefined) settings.company[key] = String(company[key] ?? '')
    }
  }
  await settings.save()
  res.json(settings)
}

/* ── Logo de l'entreprise ─────────────────────────────────────── */

async function setLogo(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })
  const settings = await AppSettings.findOne() ?? new AppSettings()
  const previous = settings.company.logo
  settings.company.logo = req.file.filename
  await settings.save()
  // L'ancien fichier ne sert plus : le garder ne ferait qu'user le quota.
  if (previous) await fsp.rm(path.join(LOGO_DIR, previous), { force: true }).catch(() => {})
  res.json(settings)
}

/** Retour au logo livré avec l'application. */
async function deleteLogo(req, res) {
  const settings = await AppSettings.findOne() ?? new AppSettings()
  const previous = settings.company.logo
  settings.company.logo = null
  await settings.save()
  if (previous) await fsp.rm(path.join(LOGO_DIR, previous), { force: true }).catch(() => {})
  res.json(settings)
}

/* ── Réinitialisation de la base ──────────────────────────────── */

/**
 * Collections vidées par la remise à zéro : toutes les données métier.
 *
 * `User` en est volontairement absent — c'est la seule chose qu'on garde, pour
 * ne pas se retrouver enfermé dehors. `AppSettings` aussi : ce sont les réglages
 * de l'application, pas des données saisies.
 */
const RESET_MODELS = [
  'Client', 'Site', 'Contract', 'Intervention', 'Control', 'Formation',
  'Appointment', 'Replacement', 'Document',
  'Product', 'ProductCategory', 'ProductItem', 'StockMovement', 'Pack',
].map(name => ({ name, model: require(`../models/${name}`) }))

/* Dossiers d'uploads liés à ces données : les fichiers n'auraient plus aucun
   enregistrement pour les désigner. `avatars` reste — il appartient aux users. */
const RESET_UPLOAD_DIRS = ['clients', 'documents', 'formations', 'interventions', 'products']

async function emptyDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    await fsp.rm(path.join(dir, entry.name), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * POST /api/app-settings/reset — remise à zéro complète, hors comptes.
 *
 * Réservée au super admin et protégée par une phrase de confirmation : le geste
 * est irréversible et ne doit pas pouvoir partir d'un clic malheureux.
 */
async function reset(req, res) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Réservé au Super Admin.' })
  }
  if (String(req.body?.confirm || '').trim().toUpperCase() !== 'REINITIALISER') {
    return res.status(422).json({ message: 'Confirmation manquante.' })
  }

  const deleted = {}
  for (const { name, model } of RESET_MODELS) {
    const { deletedCount } = await model.deleteMany({})
    deleted[name] = deletedCount
  }

  if (req.body?.keepFiles !== true) {
    for (const dir of RESET_UPLOAD_DIRS) {
      await emptyDir(path.join(__dirname, '..', 'uploads', dir))
    }
  }

  console.warn(`[RESET] Base réinitialisée par ${req.user.username} (${req.user._id})`,
    JSON.stringify(deleted))

  res.json({
    message: 'Base réinitialisée. Les comptes utilisateurs ont été conservés.',
    deleted,
  })
}

module.exports = { get, update, uploadLogo, setLogo, deleteLogo, reset }
