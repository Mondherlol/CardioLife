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
  'contact nom':      'contactName',
  'contact name':     'contactName',
  'contact':          'contactName',
  'telephone':        'phone1',
  'téléphone':        'phone1',
  'phone':            'phone1',
  'phone 1':          'phone1',
  'téléphone 1':      'phone1',
  'telephone 1':      'phone1',
  'phone 2':          'phone2',
  'téléphone 2':      'phone2',
  'telephone 2':      'phone2',
  'email':            'email1',
  'email 1':          'email1',
  'e-mail':           'email1',
  'email 2':          'email2',
  'responsable':      'internalManager',
  'responsable interne': 'internalManager',
  'internal manager': 'internalManager',
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
  if (out.email1) out.email1 = out.email1.toLowerCase()
  if (out.email2) out.email2 = out.email2.toLowerCase()
  return out
}

function validateRow(row, idx, typeMap) {
  const normalized = normalizeRow(row, typeMap)
  const errors = []

  if (!normalized.name) errors.push('Nom obligatoire')
  if (!normalized.type) errors.push('Type obligatoire')
  if (normalized.email1 && !EMAIL_RE.test(normalized.email1)) errors.push(`Email invalide : ${normalized.email1}`)
  if (normalized.email2 && !EMAIL_RE.test(normalized.email2)) errors.push(`Email 2 invalide : ${normalized.email2}`)
  if (normalized.gpsLat && Number.isNaN(Number(normalized.gpsLat))) errors.push(`Latitude invalide : ${normalized.gpsLat}`)
  if (normalized.gpsLng && Number.isNaN(Number(normalized.gpsLng))) errors.push(`Longitude invalide : ${normalized.gpsLng}`)

  return { row: normalized, rowNum: idx + 2, errors, valid: errors.length === 0 }
}

function buildClientDoc(row, userId) {
  const phones = [row.phone1, row.phone2].filter(Boolean)
  const emails = [row.email1, row.email2].filter(Boolean)
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
    contact: {
      name:   row.contactName || undefined,
      phones,
      emails,
    },
    internalManager: row.internalManager || undefined,
    notes:           row.notes           || undefined,
    createdBy:       userId,
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
