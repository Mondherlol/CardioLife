const multer = require('multer')
const XLSX   = require('xlsx')
const Client = require('../models/Client')
const ClientType = require('../models/ClientType')

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
               file.mimetype.includes('excel') ||
               file.originalname.match(/\.(xlsx|xls|csv)$/i)
    cb(null, !!ok)
  },
}).single('file')

/* ── Column map: Excel header → internal key ── */
const COL_MAP = {
  'nom':              'name',
  'name':             'name',
  'type':             'type',
  'rue':              'street',
  'street':           'street',
  'adresse':          'street',
  'ville':            'city',
  'city':             'city',
  'gouvernorat':      'governorate',
  'governorate':      'governorate',
  'gps lat':          'gpsLat',
  'latitude':         'gpsLat',
  'lat':              'gpsLat',
  'gps lng':          'gpsLng',
  'gps lon':          'gpsLng',
  'longitude':        'gpsLng',
  'lng':              'gpsLng',
  'lon':              'gpsLng',
  // Contacts (nouveaux en-têtes)
  'contact 1 nom':       'contact1Name',
  'contact 1 telephone': 'contact1Phone',
  'contact 1 email':     'contact1Email',
  'contact 2 nom':       'contact2Name',
  'contact 2 telephone': 'contact2Phone',
  'contact 2 email':     'contact2Email',
  // Responsable interne (nouveaux en-têtes)
  'responsable nom':       'managerName',
  'responsable telephone': 'managerPhone',
  'responsable email':     'managerEmail',
  // Anciens en-têtes (compatibilité) — mappés sur le contact 1 / contact 2
  'contact nom':      'contact1Name',
  'contact name':     'contact1Name',
  'contact':          'contact1Name',
  'telephone':        'contact1Phone',
  'phone':            'contact1Phone',
  'phone 1':          'contact1Phone',
  'telephone 1':      'contact1Phone',
  'phone 2':          'contact2Phone',
  'telephone 2':      'contact2Phone',
  'email':            'contact1Email',
  'email 1':          'contact1Email',
  'e-mail':           'contact1Email',
  'email 2':          'contact2Email',
  'responsable':      'managerName',
  'responsable interne': 'managerName',
  'internal manager': 'managerName',
  'notes':            'notes',
  'remarques':        'notes',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function slugify(str) {
  return normalizeText(str)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function normalizeHeader(h) {
  return normalizeText(h).replace(/\s+/g, ' ')
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function getTypeMap() {
  const types = await ClientType.find()
  const map = new Map()
  types.forEach(t => {
    map.set(normalizeText(t.slug), t.slug)
    map.set(normalizeText(t.name), t.slug)
  })
  return map
}

async function ensureClientType(rawType, typeMap) {
  const label = String(rawType || '').trim()
  const normalized = normalizeText(label)
  if (!label) return ''
  if (typeMap.has(normalized)) return typeMap.get(normalized)

  const slug = slugify(label)
  const type = await ClientType.findOneAndUpdate(
    { slug },
    { $setOnInsert: { name: label, slug } },
    { upsert: true, new: true }
  )
  typeMap.set(normalized, type.slug)
  typeMap.set(normalizeText(type.slug), type.slug)
  return type.slug
}

function parseSheet(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (raw.length < 2) return { headers: [], rows: [] }

  const headers = raw[0].map(normalizeHeader)
  const rows = raw.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, i) => {
      const key = COL_MAP[h]
      if (key) obj[key] = String(r[i] ?? '').trim()
    })
    return obj
  }).filter(r => Object.values(r).some(v => v !== ''))

  return { headers, rows }
}

function normalizeRow(row, typeMap) {
  const out = { ...row }
  if (out.type) out.type = typeMap.get(normalizeText(out.type)) || slugify(out.type)
  for (const k of ['contact1Email', 'contact2Email', 'managerEmail']) {
    if (out[k]) out[k] = out[k].toLowerCase()
  }
  return out
}

function validateRow(row, idx, typeMap) {
  const normalized = normalizeRow(row, typeMap)
  const errors = []

  if (!normalized.name) errors.push('Nom obligatoire')
  if (!normalized.type) errors.push('Type obligatoire')
  if (normalized.contact1Email && !EMAIL_RE.test(normalized.contact1Email)) errors.push(`Email contact 1 invalide : ${normalized.contact1Email}`)
  if (normalized.contact2Email && !EMAIL_RE.test(normalized.contact2Email)) errors.push(`Email contact 2 invalide : ${normalized.contact2Email}`)
  if (normalized.managerEmail && !EMAIL_RE.test(normalized.managerEmail)) errors.push(`Email responsable invalide : ${normalized.managerEmail}`)
  if (normalized.gpsLat && Number.isNaN(Number(normalized.gpsLat))) errors.push(`Latitude invalide : ${normalized.gpsLat}`)
  if (normalized.gpsLng && Number.isNaN(Number(normalized.gpsLng))) errors.push(`Longitude invalide : ${normalized.gpsLng}`)

  return { row: normalized, rowNum: idx + 2, errors, valid: errors.length === 0 }
}

function buildPerson(name, phone, email) {
  if (!name && !phone && !email) return null
  return { name: name || '', phone: phone || '', email: email || '' }
}

function buildClientDoc(row, userId) {
  const contacts = [
    buildPerson(row.contact1Name, row.contact1Phone, row.contact1Email),
    buildPerson(row.contact2Name, row.contact2Phone, row.contact2Email),
  ].filter(Boolean)
  const internalManagers = [
    buildPerson(row.managerName, row.managerPhone, row.managerEmail),
  ].filter(Boolean)

  return {
    name:  row.name,
    type:  row.type,
    address: {
      street:      row.street      || undefined,
      city:        row.city        || undefined,
      governorate: row.governorate || undefined,
      gps: {
        lat: row.gpsLat ? Number(row.gpsLat) : undefined,
        lng: row.gpsLng ? Number(row.gpsLng) : undefined,
      },
    },
    contacts,
    internalManagers,
    notes:     row.notes || undefined,
    createdBy: userId,
  }
}

/* ── Validate endpoint (dry-run) ── */
async function validate(req, res) {
  await new Promise((resolve, reject) =>
    upload(req, res, err => (err ? reject(err) : resolve()))
  )

  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })

  let workbook
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
  } catch {
    return res.status(400).json({ message: 'Fichier Excel invalide ou corrompu.' })
  }

  const { rows } = parseSheet(workbook)
  if (rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne de données trouvée dans le fichier.' })
  }

  const typeMap = await getTypeMap()
  const results = rows.map((r, i) => validateRow(r, i, typeMap))
  const valid   = results.filter(r => r.valid).length
  const invalid = results.filter(r => !r.valid).length

  res.json({ results, summary: { total: rows.length, valid, invalid } })
}

/* ── Execute endpoint (real import) ── */
async function execute(req, res) {
  const { rows } = req.body
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne à importer.' })
  }

  const results = []
  const typeMap = await getTypeMap()
  for (const row of rows) {
    try {
      const normalized = normalizeRow(row, typeMap)
      normalized.type = await ensureClientType(normalized.type, typeMap)
      const doc = buildClientDoc(normalized, req.user._id)
      const existing = await Client.findOne({
        name: { $regex: `^${escapeRegex(normalized.name)}$`, $options: 'i' },
      })
      const client = existing
        ? await Client.findByIdAndUpdate(existing._id, { $set: doc }, { new: true, runValidators: true })
        : await Client.create(doc)
      results.push({
        name: normalized.name,
        success: true,
        id: client._id,
        action: existing ? 'updated' : 'created',
      })
    } catch (err) {
      results.push({ name: row.name, success: false, error: err.message })
    }
  }

  const imported = results.filter(r => r.success).length
  const created  = results.filter(r => r.action === 'created').length
  const updated  = results.filter(r => r.action === 'updated').length
  const failed   = results.filter(r => !r.success).length
  res.json({ results, summary: { imported, created, updated, failed } })
}

module.exports = { validate, execute }
