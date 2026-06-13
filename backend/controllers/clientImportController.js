const multer = require('multer')
const XLSX   = require('xlsx')
const Client = require('../models/Client')

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

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, ' ')
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

function validateRow(row, idx) {
  const errors = []

  if (!row.name) errors.push('Nom obligatoire')
  if (!row.type) errors.push('Type obligatoire')
  if (row.email1 && !EMAIL_RE.test(row.email1)) errors.push(`Email invalide : ${row.email1}`)
  if (row.email2 && !EMAIL_RE.test(row.email2)) errors.push(`Email 2 invalide : ${row.email2}`)

  return { row, rowNum: idx + 2, errors, valid: errors.length === 0 }
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

  const results = rows.map((r, i) => validateRow(r, i))
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
  for (const row of rows) {
    try {
      const doc = buildClientDoc(row, req.user._id)
      const client = await Client.create(doc)
      results.push({ name: row.name, success: true, id: client._id })
    } catch (err) {
      results.push({ name: row.name, success: false, error: err.message })
    }
  }

  const imported = results.filter(r => r.success).length
  const failed   = results.filter(r => !r.success).length
  res.json({ results, summary: { imported, failed } })
}

module.exports = { validate, execute }
