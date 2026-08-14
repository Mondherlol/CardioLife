const multer  = require('multer')
const XLSX    = require('xlsx')
const Client  = require('../models/Client')
const Site    = require('../models/Site')
const Product = require('../models/Product')
const { syncDeaWithItem } = require('../utils/productItems')

/**
 * Import Excel du parc, aligné sur la structure Client → Site → DAE.
 *
 * Une ligne = un DAE. Les colonnes client et site se répètent d'une ligne à
 * l'autre : les lignes sont regroupées à l'import, si bien qu'un client avec
 * trois sites de deux DAE tient en six lignes. Une ligne sans colonne DAE crée
 * simplement le client et son site.
 */

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

/* ── En-tête Excel → clé interne ────────────────────────────────
   Les colonnes reprennent exactement ce que l'application affiche : client,
   site (adresse + responsables), DAE et consommables. Rien de plus.
   Les anciens en-têtes (« rue », import d'avant les sites) restent reconnus :
   l'adresse du client sert alors de repli pour le site principal. */
const COL_MAP = {
  /* Client */
  'client':                'name',
  'nom':                   'name',
  'nom du client':         'name',
  'name':                  'name',
  'client adresse':        'clientStreet',
  'client rue':            'clientStreet',
  'client ville':          'clientCity',
  'sous contrat':          'underContract',
  'contrat':               'underContract',
  'notes':                 'notes',
  'remarques':             'notes',

  /* Site */
  'site':                  'siteName',
  'nom du site':           'siteName',
  'site adresse':          'siteStreet',
  'site rue':              'siteStreet',
  'site ville':            'siteCity',
  'site notes':            'siteNotes',
  'responsable':           'siteContactName',
  'responsable nom':       'siteContactName',
  'responsable telephone': 'siteContactPhone',
  'responsable email':     'siteContactEmail',
  'site responsable':           'siteContactName',
  'site responsable nom':       'siteContactName',
  'site responsable telephone': 'siteContactPhone',
  'site responsable email':     'siteContactEmail',

  /* DAE */
  'dae type':               'deaType',
  'dae modele':             'deaType',
  'type de dae':            'deaType',
  'dae numero de serie':    'deaSerial',
  'dae n serie':            'deaSerial',
  'numero de serie':        'deaSerial',
  'dae emplacement':        'deaLocation',
  'emplacement':            'deaLocation',
  'dae date installation':  'deaInstallDate',
  'date installation':      'deaInstallDate',
  'dae statut':             'deaStatus',
  'dae type de controle':   'deaControlType',
  'type de controle':       'deaControlType',
  'dae prochain controle':  'deaNextControl',
  'prochain controle':      'deaNextControl',
  'dae notes':              'deaNotes',

  /* Consommables du DAE */
  'batterie numero de serie': 'battSerial',
  'batterie n serie':         'battSerial',
  'batterie modele':          'battProductName',
  'batterie date expiration': 'battExpiry',
  'batterie expiration':      'battExpiry',
  'batterie niveau':          'battLevel',
  'electrodes type':          'elecKind',
  'electrodes modele':        'elecProductName',
  'electrodes lot':           'elecLot',
  'electrodes numero de lot': 'elecLot',
  'electrodes date expiration': 'elecExpiry',
  'electrodes expiration':      'elecExpiry',

  /* Anciens en-têtes — adresse du client et responsable sans préfixe */
  'rue':       'clientStreet',
  'street':    'clientStreet',
  'adresse':   'clientStreet',
  'ville':     'clientCity',
  'city':      'clientCity',
  'telephone': 'siteContactPhone',
  'phone':     'siteContactPhone',
  'email':     'siteContactEmail',
  'e-mail':    'siteContactEmail',
}

/* Colonnes qui, dès qu'elles sont remplies, décrivent un DAE. */
const DEA_KEYS = [
  'deaType', 'deaSerial', 'deaLocation', 'deaInstallDate', 'deaStatus',
  'deaControlType', 'deaNextControl', 'deaNotes',
  'battSerial', 'battProductName', 'battExpiry', 'battLevel',
  'elecKind', 'elecProductName', 'elecLot', 'elecExpiry',
]

const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_SITE_NAME = 'Site principal'

function normalizeText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')   // accents décomposés par NFD
}

function normalizeHeader(h) {
  return normalizeText(h).replace(/[°.]/g, '').replace(/\s+/g, ' ')
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Regex d'égalité insensible à la casse et aux espaces de bord. */
function exactRe(value) {
  return { $regex: `^${escapeRegex(String(value).trim())}$`, $options: 'i' }
}

/* ── Conversions de cellules ─────────────────────────────────── */

/**
 * Date d'une cellule : objet Date (Excel lu avec cellDates), 'jj/mm/aaaa',
 * 'aaaa-mm-jj' ou numéro de série Excel. Retourne 'aaaa-mm-jj' ou ''.
 */
function toISODate(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const str = String(value).trim()
  if (!str) return ''

  const fr = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (fr) {
    const [, d, m, y] = fr
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  // Numéro de série Excel (jours depuis le 30/12/1899).
  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = Number(str)
    if (serial > 20000 && serial < 80000) {
      return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10)
    }
  }

  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function toBool(value) {
  const v = normalizeText(value)
  if (!v) return undefined
  return ['oui', 'yes', 'true', 'vrai', '1', 'x', 'sous contrat'].includes(v)
}

/** Statut de pose : « installé » par défaut, l'import décrivant l'existant. */
function toDeaStatus(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (['installe', 'pose', 'posee', 'actif', 'en service', 'ok'].includes(v)) return 'installe'
  if (['a installer', 'a poser', 'planifie', 'planifiee', 'en attente'].includes(v)) return 'a_installer'
  return null   // valeur non reconnue
}

function toControlType(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (v.startsWith('semestr')) return 'semestriel'
  if (v.startsWith('annuel') || v === 'an') return 'annuel'
  return null
}

function toElectrodeKind(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (v.startsWith('adulte') || v === 'adult') return 'adulte'
  if (v.startsWith('enfant') || v.startsWith('pedia') || v === 'child') return 'enfant'
  return null
}

/* ── Lecture de la feuille ───────────────────────────────────── */

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
      const cell = r[i]
      obj[key] = cell instanceof Date ? cell : String(cell ?? '').trim()
    })
    return obj
  }).filter(r => Object.values(r).some(v => v !== '' && v != null))

  return { headers, rows }
}

/* ── Normalisation et validation d'une ligne ─────────────────── */

const DATE_FIELDS = ['deaInstallDate', 'deaNextControl', 'battExpiry', 'elecExpiry']

function normalizeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v : String(v ?? '').trim()
  }
  if (out.siteContactEmail) out.siteContactEmail = String(out.siteContactEmail).toLowerCase()
  // Les dates sont figées en 'aaaa-mm-jj' dès la validation : la ligne
  // renvoyée au client puis rejouée à l'import ne dépend plus d'Excel.
  for (const k of DATE_FIELDS) {
    if (out[k] !== undefined && out[k] !== '') {
      const iso = toISODate(out[k])
      out[k] = iso === null ? `__INVALID__${out[k]}` : iso
    }
  }
  return out
}

function hasDea(row) {
  return DEA_KEYS.some(k => row[k])
}

function validateRow(row, idx) {
  const r      = normalizeRow(row)
  const errors = []

  if (!r.name) errors.push('Nom du client obligatoire')

  if (r.siteContactEmail && !EMAIL_RE.test(r.siteContactEmail)) {
    errors.push(`Email du responsable invalide : ${r.siteContactEmail}`)
  }

  for (const [key, label] of [
    ['deaInstallDate', "Date d'installation"], ['deaNextControl', 'Date du prochain contrôle'],
    ['battExpiry', "Date d'expiration de la batterie"], ['elecExpiry', "Date d'expiration des électrodes"],
  ]) {
    if (String(r[key] || '').startsWith('__INVALID__')) {
      errors.push(`${label} illisible : ${String(r[key]).replace('__INVALID__', '')} (format attendu jj/mm/aaaa)`)
    }
  }

  if (toDeaStatus(r.deaStatus) === null)      errors.push(`Statut DAE inconnu : ${r.deaStatus} (attendu « installé » ou « à installer »)`)
  if (toControlType(r.deaControlType) === null) errors.push(`Type de contrôle inconnu : ${r.deaControlType} (attendu « semestriel » ou « annuel »)`)
  if (toElectrodeKind(r.elecKind) === null)   errors.push(`Type d'électrodes inconnu : ${r.elecKind} (attendu « adulte » ou « enfant »)`)

  if (r.battLevel) {
    const lvl = Number(r.battLevel)
    if (Number.isNaN(lvl) || lvl < 0 || lvl > 100) errors.push(`Niveau de batterie invalide : ${r.battLevel} (0 à 100)`)
  }

  // Un DAE décrit sans type ni numéro de série ne serait pas identifiable.
  if (hasDea(r) && !r.deaType && !r.deaSerial) {
    errors.push('DAE incomplet : renseignez au moins le type ou le numéro de série')
  }

  return {
    row: r,
    rowNum: idx + 2,
    errors,
    // Non bloquants : signalés dans l'aperçu, ils n'empêchent pas l'import.
    warnings: [],
    valid: errors.length === 0,
    // Repris tel quel par l'aperçu de l'écran d'import.
    siteName: r.siteName || DEFAULT_SITE_NAME,
    hasDea: hasDea(r),
  }
}

/* ── Construction des documents ──────────────────────────────── */

/** Responsable du site : nom, téléphone, email — rien d'autre. */
function buildPerson(name, phone, email) {
  if (!name && !phone && !email) return null
  return { name: name || '', phone: phone || '', email: email || '' }
}

/** Champs client, sans les valeurs vides : un import partiel n'efface rien. */
function clientPatch(row) {
  const set = { name: row.name }
  if (row.clientStreet) set['address.street'] = row.clientStreet
  if (row.clientCity)   set['address.city']   = row.clientCity
  if (row.notes)        set.notes             = row.notes
  const contract = toBool(row.underContract)
  if (contract !== undefined) set.underContract = contract
  return set
}

/** Deux personnes se valent si nom, téléphone et email coïncident. */
function samePerson(a, b) {
  return normalizeText(a.name)  === normalizeText(b.name) &&
         normalizeText(a.phone) === normalizeText(b.phone) &&
         normalizeText(a.email) === normalizeText(b.email)
}

function mergePeople(existing = [], incoming = []) {
  const out = [...existing]
  for (const p of incoming) {
    if (!out.some(e => samePerson(e, p))) out.push(p)
  }
  return out
}

/**
 * Applique une ligne à un DAE du site : création s'il n'existe pas, mise à
 * jour sinon. Le DAE est reconnu par son numéro de série, à défaut par le
 * couple type + emplacement.
 */
function upsertDea(site, row, productId) {
  const serial = String(row.deaSerial || '').trim()
  let dea = serial
    ? site.deas.find(d => normalizeText(d.serialNumber) === normalizeText(serial))
    : site.deas.find(d => normalizeText(d.deviceType) === normalizeText(row.deaType) &&
                          normalizeText(d.location)   === normalizeText(row.deaLocation))

  const created = !dea
  if (created) {
    site.deas.push({ status: 'installe' })
    dea = site.deas[site.deas.length - 1]
  }

  if (row.deaType)       dea.deviceType   = row.deaType
  if (serial)            dea.serialNumber = serial
  if (row.deaLocation)   dea.location     = row.deaLocation
  if (row.deaNotes)      dea.notes        = row.deaNotes
  if (productId)         dea.product      = productId

  const status = toDeaStatus(row.deaStatus)
  if (status) dea.status = status

  const controlType = toControlType(row.deaControlType)
  if (controlType) dea.controlType = controlType

  if (row.deaInstallDate) {
    dea.installationDate = new Date(row.deaInstallDate)
    // Une date de pose renseignée signifie un appareil posé, sauf mention contraire.
    if (!status) dea.status = 'installe'
  }
  if (row.deaNextControl) dea.nextControlDate = new Date(row.deaNextControl)

  /* Batterie — reconnue par son numéro de série, sinon la première de la liste. */
  if (row.battSerial || row.battExpiry || row.battLevel || row.battProductName) {
    const bSerial = String(row.battSerial || '').trim()
    let batt = bSerial
      ? dea.batteries.find(b => normalizeText(b.serialNumber) === normalizeText(bSerial))
      : dea.batteries[0]
    if (!batt) {
      dea.batteries.push({})
      batt = dea.batteries[dea.batteries.length - 1]
    }
    if (bSerial)              batt.serialNumber = bSerial
    if (row.battProductName)  batt.productName  = row.battProductName
    if (row.battExpiry)       batt.expiryDate   = new Date(row.battExpiry)
    if (row.battLevel)        batt.level        = Number(row.battLevel)
  }

  /* Électrodes — reconnues par leur numéro de lot, sinon par leur type. */
  if (row.elecLot || row.elecExpiry || row.elecKind || row.elecProductName) {
    const lot  = String(row.elecLot || '').trim()
    const kind = toElectrodeKind(row.elecKind) || ''
    let elec = lot
      ? dea.electrodes.find(e => normalizeText(e.lotNumber) === normalizeText(lot))
      : dea.electrodes.find(e => (e.kind || '') === kind)
    if (!elec) {
      dea.electrodes.push({})
      elec = dea.electrodes[dea.electrodes.length - 1]
    }
    if (lot)                  elec.lotNumber   = lot
    if (kind)                 elec.kind        = kind
    if (row.elecProductName)  elec.productName = row.elecProductName
    if (row.elecExpiry)       elec.expiryDate  = new Date(row.elecExpiry)
  }

  return { dea, created }
}

/* ── Validation (simulation) ─────────────────────────────────── */

async function validate(req, res) {
  await new Promise((resolve, reject) =>
    upload(req, res, err => (err ? reject(err) : resolve()))
  )

  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })

  let workbook
  try {
    // cellDates : les dates arrivent en objets Date plutôt qu'en numéros de série.
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })
  } catch {
    return res.status(400).json({ message: 'Fichier Excel invalide ou corrompu.' })
  }

  const { rows } = parseSheet(workbook)
  if (rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne de données trouvée dans le fichier.' })
  }

  const results = rows.map((r, i) => validateRow(r, i))

  // Un même numéro de série ne peut désigner deux appareils : on le signale
  // sur toutes les lignes concernées plutôt que d'échouer à l'import.
  const serialRows = {}
  results.forEach(r => {
    const sn = normalizeText(r.row.deaSerial)
    if (sn) (serialRows[sn] ||= []).push(r)
  })
  Object.entries(serialRows).forEach(([, group]) => {
    if (group.length > 1) {
      group.forEach(r => {
        r.errors.push(`N° de série en double dans le fichier (lignes ${group.map(g => g.rowNum).join(', ')})`)
        r.valid = false
      })
    }
  })

  /* Un DAE déjà enregistré ailleurs : l'import le laisserait en double, puisque
     les appareils sont reconnus site par site. Averti, pas bloqué — déplacer un
     appareil d'un site à l'autre reste un cas légitime. */
  const serials = results.map(r => String(r.row.deaSerial || '').trim()).filter(Boolean)
  if (serials.length) {
    const known = await Site.find({ 'deas.serialNumber': { $in: serials } })
      .select('name deas.serialNumber')
      .lean()
    const placed = {}
    known.forEach(s => s.deas.forEach(d => {
      const sn = normalizeText(d.serialNumber)
      if (sn) placed[sn] = s.name
    }))
    results.forEach(r => {
      const site = placed[normalizeText(r.row.deaSerial)]
      if (site && normalizeText(site) !== normalizeText(r.siteName)) {
        r.warnings.push(`N° de série déjà posé sur le site « ${site} » — il y sera déplacé ou dupliqué`)
      }
    })
  }

  const valid = results.filter(r => r.valid)
  const uniq  = (list, fn) => new Set(list.map(fn).filter(Boolean)).size

  res.json({
    results,
    summary: {
      total:   rows.length,
      valid:   valid.length,
      invalid: results.length - valid.length,
      clients:  uniq(valid, r => normalizeText(r.row.name)),
      sites:    uniq(valid, r => `${normalizeText(r.row.name)}|${normalizeText(r.siteName)}`),
      deas:     valid.filter(r => r.hasDea).length,
      warnings: results.filter(r => r.warnings.length > 0).length,
    },
  })
}

/* ── Import réel ─────────────────────────────────────────────── */

/** Modèle de DAE correspondant au libellé saisi, pour lier le parc au stock. */
async function resolveProduct(name, cache) {
  const key = normalizeText(name)
  if (!key) return null
  if (key in cache) return cache[key]
  const product = await Product.findOne({ name: exactRe(name), isActive: { $ne: false } }).select('_id')
  cache[key] = product?._id || null
  return cache[key]
}

async function execute(req, res) {
  const { rows } = req.body
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne à importer.' })
  }

  // Regroupement client → site → lignes : un client réparti sur plusieurs
  // lignes n'est traité qu'une fois.
  const clients = new Map()
  for (const raw of rows) {
    const row = normalizeRow(raw)
    if (!row.name) continue
    const cKey = normalizeText(row.name)
    if (!clients.has(cKey)) clients.set(cKey, { name: row.name, rows: [], sites: new Map() })
    const entry = clients.get(cKey)
    entry.rows.push(row)

    const sName = row.siteName || DEFAULT_SITE_NAME
    const sKey  = normalizeText(sName)
    if (!entry.sites.has(sKey)) entry.sites.set(sKey, { name: sName, rows: [] })
    entry.sites.get(sKey).rows.push(row)
  }

  const productCache = {}
  const results = []

  for (const entry of clients.values()) {
    try {
      /* ── Client ── */
      const set = Object.assign({}, ...entry.rows.map(clientPatch))

      let client = await Client.findOne({ name: exactRe(entry.name) })
      const clientCreated = !client
      if (!client) {
        client = await Client.create({ ...set, createdBy: req.user._id })
      } else {
        // Mise à jour non destructive : les champs absents du fichier sont conservés.
        client.set(set)
        await client.save()
      }

      /* ── Sites et DAE ── */
      let sitesCreated = 0, deasCreated = 0, deasUpdated = 0
      for (const siteEntry of entry.sites.values()) {
        let site = await Site.findOne({ client: client._id, name: exactRe(siteEntry.name) })
        if (!site) {
          site = new Site({ client: client._id, name: siteEntry.name, createdBy: req.user._id })
          sitesCreated++
        }

        for (const row of siteEntry.rows) {
          // Adresse du site : ses propres colonnes, à défaut celles du client.
          const street = row.siteStreet || row.clientStreet
          const city   = row.siteCity   || row.clientCity
          if (street) site.address.street = street
          if (city)   site.address.city   = city
          if (row.siteNotes) site.notes = row.siteNotes

          const contact = buildPerson(row.siteContactName, row.siteContactPhone, row.siteContactEmail)
          if (contact) site.contacts = mergePeople(site.contacts, [contact])

          if (hasDea(row)) {
            const productId = await resolveProduct(row.deaType, productCache)
            const { created } = upsertDea(site, row, productId)
            if (created) deasCreated++; else deasUpdated++
          }
        }

        await site.save()

        // Une fois le site enregistré, les DAE ont un _id : le stock peut suivre.
        for (const row of siteEntry.rows) {
          if (!hasDea(row)) continue
          const sn  = normalizeText(row.deaSerial)
          const dea = sn
            ? site.deas.find(d => normalizeText(d.serialNumber) === sn)
            : site.deas.find(d => normalizeText(d.deviceType) === normalizeText(row.deaType) &&
                                  normalizeText(d.location)   === normalizeText(row.deaLocation))
          if (dea) await syncDeaWithItem(site, dea).catch(() => {})
        }
      }

      results.push({
        name: entry.name,
        success: true,
        id: client._id,
        action: clientCreated ? 'created' : 'updated',
        sites: entry.sites.size,
        sitesCreated,
        deasCreated,
        deasUpdated,
      })
    } catch (err) {
      results.push({ name: entry.name, success: false, error: err.message })
    }
  }

  const sum = (key) => results.reduce((n, r) => n + (r[key] || 0), 0)
  res.json({
    results,
    summary: {
      imported: results.filter(r => r.success).length,
      created:  results.filter(r => r.action === 'created').length,
      updated:  results.filter(r => r.action === 'updated').length,
      failed:   results.filter(r => !r.success).length,
      sitesCreated: sum('sitesCreated'),
      deasCreated:  sum('deasCreated'),
      deasUpdated:  sum('deasUpdated'),
    },
  })
}

module.exports = { validate, execute }
