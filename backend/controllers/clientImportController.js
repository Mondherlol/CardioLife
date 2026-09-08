const multer          = require('multer')
const XLSX            = require('xlsx')
const Client          = require('../models/Client')
const Site            = require('../models/Site')
const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')
const ProductItem     = require('../models/ProductItem')
const Intervention    = require('../models/Intervention')
const { syncDeaWithItem, syncProductStock } = require('../utils/productItems')
const { addMonths, skipWeekend, syncSiteNextControl, PERIOD_MONTHS } = require('../utils/controls')

/**
 * Import Excel du parc, aligné sur la structure Client → Site → DAE.
 *
 * Une ligne = un DAE. Les colonnes client et site se répètent d'une ligne à
 * l'autre : les lignes sont regroupées à l'import, si bien qu'un client avec
 * trois sites de deux DAE tient en six lignes. Une ligne sans colonne DAE crée
 * simplement le client et son site.
 *
 * L'import se joue en deux temps :
 *  1. `validate` lit le fichier, dit ce qu'il a compris de chaque colonne,
 *     signale ce qui bloque et ce qui mérite un œil, et rend la liste des
 *     modèles de DAE qu'il ne reconnaît pas au catalogue ;
 *  2. `execute` rejoue les lignes validées avec les décisions prises sur ces
 *     modèles, crée ou met à jour clients, sites et DAE, rattache le stock et
 *     planifie les visites à partir du dernier contrôle.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
               file.mimetype.includes('excel') ||
               file.mimetype.includes('csv') ||
               file.originalname.match(/\.(xlsx|xls|csv)$/i)
    cb(null, !!ok)
  },
}).single('file')

/* ── En-tête Excel → clé interne ────────────────────────────────
   Les libellés sont normalisés avant recherche (sans accent, sans apostrophe
   ni ponctuation) : « Date d'installation », « DATE INSTALLATION » et
   « date_installation » tombent sur la même entrée. Un en-tête inconnu est
   ensuite rapproché par ressemblance, et le rapport de lecture dit dans quelle
   colonne chaque champ a été trouvé. */
const COL_MAP = {
  /* ── Client ── */
  'client':                 'name',
  'nom':                    'name',
  'nom du client':          'name',
  'nom client':             'name',
  'raison sociale':         'name',
  'societe':                'name',
  'name':                   'name',
  'client adresse':         'clientStreet',
  'client rue':             'clientStreet',
  'adresse client':         'clientStreet',
  'client ville':           'clientCity',
  'ville client':           'clientCity',
  'client gouvernorat':     'clientGovernorate',
  'gouvernorat client':     'clientGovernorate',
  'sous contrat':           'underContract',
  'contrat':                'underContract',
  'contrat de maintenance': 'underContract',
  'sous contrat de maintenance': 'underContract',
  'notes':                  'notes',
  'remarques':              'notes',
  'commentaire':            'notes',
  'commentaires':           'notes',

  /* ── Site ── */
  'site':                   'siteName',
  'nom du site':            'siteName',
  'nom site':               'siteName',
  'site nom':               'siteName',
  'nom de l agence':        'siteName',
  'agence':                 'siteName',
  'site adresse':           'siteStreet',
  'site rue':               'siteStreet',
  'adresse du site':        'siteStreet',
  'site ville':             'siteCity',
  'ville du site':          'siteCity',
  'site gouvernorat':       'siteGovernorate',
  'gouvernorat du site':    'siteGovernorate',
  'site notes':             'siteNotes',
  'responsable':                'siteContactName',
  'responsable du site':        'siteContactName',
  'responsable site':           'siteContactName',
  'nom du responsable':         'siteContactName',
  'contact':                    'siteContactName',
  'personne a contacter':       'siteContactName',
  'responsable nom':            'siteContactName',
  'site responsable':           'siteContactName',
  'site responsable nom':       'siteContactName',
  'responsable telephone':      'siteContactPhone',
  'telephone du responsable':   'siteContactPhone',
  'num de telephone':           'siteContactPhone',
  'numero de telephone':        'siteContactPhone',
  'n de telephone':             'siteContactPhone',
  'tel':                        'siteContactPhone',
  'gsm':                        'siteContactPhone',
  'mobile':                     'siteContactPhone',
  'portable':                   'siteContactPhone',
  'contact telephone':          'siteContactPhone',
  'site responsable telephone': 'siteContactPhone',
  'responsable email':          'siteContactEmail',
  'email du responsable':       'siteContactEmail',
  'adresse email':              'siteContactEmail',
  'mail':                       'siteContactEmail',
  'courriel':                   'siteContactEmail',
  'contact email':              'siteContactEmail',
  'site responsable email':     'siteContactEmail',

  /* ── DAE ── */
  'type dea':               'deaType',
  'type dae':               'deaType',
  'dae type':               'deaType',
  'dea type':               'deaType',
  'type de dae':            'deaType',
  'type de dea':            'deaType',
  'type d appareil':        'deaType',
  'modele':                 'deaType',
  'modele dae':             'deaType',
  'modele dea':             'deaType',
  'modele du dae':          'deaType',
  'dae modele':             'deaType',
  'appareil':               'deaType',
  'serial number':          'deaSerial',
  'serial':                 'deaSerial',
  'sn':                     'deaSerial',
  'numero de serie':        'deaSerial',
  'numero serie':           'deaSerial',
  'n de serie':             'deaSerial',
  'n serie':                'deaSerial',
  'dae numero de serie':    'deaSerial',
  'dea numero de serie':    'deaSerial',
  'dae n serie':            'deaSerial',
  'serie du dae':           'deaSerial',
  'emplacement':            'deaLocation',
  'dae emplacement':        'deaLocation',
  'localisation':           'deaLocation',
  'lieu':                   'deaLocation',
  'position':               'deaLocation',
  'date d installation':    'deaInstallDate',
  'date installation':      'deaInstallDate',
  'date de pose':           'deaInstallDate',
  'date de mise en service':'deaInstallDate',
  'installation':           'deaInstallDate',
  'dae date installation':  'deaInstallDate',
  'dae statut':             'deaStatus',
  'statut':                 'deaStatus',
  'statut du dae':          'deaStatus',
  'etat':                   'deaStatus',
  'type de controle':       'deaControlType',
  'dae type de controle':   'deaControlType',
  'periodicite':            'deaControlType',
  'periodicite des controles': 'deaControlType',
  'prochain controle':      'deaNextControl',
  'date prochain controle': 'deaNextControl',
  'dae prochain controle':  'deaNextControl',
  'prochaine visite':       'deaNextControl',
  'dernier controle':       'deaLastControl',
  'date dernier controle':  'deaLastControl',
  'derniere visite':        'deaLastControl',
  'date de la derniere visite': 'deaLastControl',
  'dae dernier controle':   'deaLastControl',
  'dae notes':              'deaNotes',
  'notes dae':              'deaNotes',

  /* ── Batterie ── */
  'batterie numero de serie': 'battSerial',
  'batterie n serie':         'battSerial',
  'numero de serie batterie': 'battSerial',
  'batterie lot':             'battLot',
  'batterie numero de lot':   'battLot',
  'lot batterie':             'battLot',
  'batterie modele':          'battProductName',
  'modele batterie':          'battProductName',
  'type de batterie':         'battProductName',
  'batterie dlc':             'battExpiry',
  'dlc batterie':             'battExpiry',
  'batterie date expiration': 'battExpiry',
  'batterie expiration':      'battExpiry',
  'batterie peremption':      'battExpiry',
  'peremption batterie':      'battExpiry',
  'date expiration batterie': 'battExpiry',
  'batterie charge':          'battLevel',
  'charge batterie':          'battLevel',
  'batterie niveau':          'battLevel',
  'niveau batterie':          'battLevel',
  'niveau de charge':         'battLevel',
  'charge':                   'battLevel',

  /* ── Électrodes ── */
  'electrodes type':            'elecKind',
  'type electrodes':            'elecKind',
  'type d electrodes':          'elecKind',
  'electrodes modele':          'elecProductName',
  'modele electrodes':          'elecProductName',
  'electrodes lot':             'elecLot',
  'electrodes numero de lot':   'elecLot',
  'lot electrodes':             'elecLot',
  'dlc electrodes':             'elecExpiry',
  'electrodes dlc':             'elecExpiry',
  'electrodes date expiration': 'elecExpiry',
  'electrodes expiration':      'elecExpiry',
  'electrodes peremption':      'elecExpiry',
  'peremption electrodes':      'elecExpiry',
  'date expiration electrodes': 'elecExpiry',

  /* ── Colonnes sans préfixe : elles valent pour le site, et servent de repli
        pour l'adresse du client quand celui-ci n'a pas la sienne. ── */
  'adresse':    'street',
  'rue':        'street',
  'street':     'street',
  'ville':      'city',
  'city':       'city',
  'gouvernorat':'governorate',
  'governorat': 'governorate',
  'region':     'governorate',
  'telephone':  'siteContactPhone',
  'phone':      'siteContactPhone',
  'email':      'siteContactEmail',
  'e mail':     'siteContactEmail',
}

/* Libellés des champs, pour le rapport de lecture affiché avant l'import. */
const FIELD_LABELS = {
  name: 'Client', clientStreet: 'Adresse du client', clientCity: 'Ville du client',
  clientGovernorate: 'Gouvernorat du client', underContract: 'Sous contrat', notes: 'Notes du client',
  siteName: 'Nom du site', siteStreet: 'Adresse du site', siteCity: 'Ville du site',
  siteGovernorate: 'Gouvernorat du site', siteNotes: 'Notes du site',
  siteContactName: 'Responsable du site', siteContactPhone: 'Téléphone du responsable',
  siteContactEmail: 'Email du responsable',
  street: 'Adresse (site + client)', city: 'Ville (site + client)', governorate: 'Gouvernorat (site + client)',
  deaType: 'Modèle du DAE', deaSerial: 'N° de série du DAE', deaLocation: 'Emplacement',
  deaInstallDate: "Date d'installation", deaStatus: 'Statut du DAE', deaControlType: 'Type de contrôle',
  deaNextControl: 'Prochain contrôle', deaLastControl: 'Dernier contrôle', deaNotes: 'Notes du DAE',
  battSerial: 'N° de série de la batterie', battLot: 'N° de lot de la batterie',
  battProductName: 'Modèle de batterie', battExpiry: 'DLC batterie', battLevel: 'Charge batterie',
  elecKind: "Type d'électrodes", elecProductName: "Modèle d'électrodes", elecLot: 'Lot électrodes',
  elecExpiry: 'DLC électrodes',
}

/* Colonnes qui, dès qu'elles sont remplies, décrivent un DAE. */
const DEA_KEYS = [
  'deaType', 'deaSerial', 'deaLocation', 'deaInstallDate', 'deaStatus',
  'deaControlType', 'deaNextControl', 'deaLastControl', 'deaNotes',
  'battSerial', 'battLot', 'battProductName', 'battExpiry', 'battLevel',
  'elecKind', 'elecProductName', 'elecLot', 'elecExpiry',
]

const EMAIL_RE          = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_SITE_NAME = 'Site principal'
const DEA_CATEGORY      = 'defibrillateurs'
/* Horizon de planification par défaut : la visite qui vient, et celle d'après
   si elle tombe dans l'année. */
const DEFAULT_HORIZON_MONTHS = 12

/* Marques reconnues dans un libellé de modèle, pour préremplir la fiche du
   produit créé à l'import. La liste n'a pas à être exhaustive : elle évite
   simplement de créer des modèles sans marque quand elle est lisible. */
const BRANDS = [
  'Powerheart', 'Cardiac Science', 'Zoll', 'Defibtech', 'Philips', 'HeartSine',
  'Physio-Control', 'Schiller', 'Mindray', 'Nihon Kohden', 'Primedic', 'Metrax',
  'Cardiolife', 'Lifepak', 'Samaritan', 'Saver One', 'Progetti', 'Bexen',
]

/* ── Petits utilitaires ──────────────────────────────────────── */

function normalizeText(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')   // accents décomposés par NFD
}

/** En-tête ramené à sa forme canonique : sans accent ni ponctuation. */
function normalizeHeader(h) {
  return normalizeText(h)
    .replace(/[°.'’`_\-/\\(),;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Regex d'égalité insensible à la casse et aux espaces de bord. */
function exactRe(value) {
  return { $regex: `^${escapeRegex(String(value).trim())}$`, $options: 'i' }
}

/* Ressemblance entre deux textes : coefficient de Dice sur les bigrammes.
   Sert deux fois — à rapprocher un en-tête inconnu d'un en-tête connu, et à
   proposer les modèles du catalogue les plus proches d'un libellé du fichier. */
function bigrams(str) {
  const s = ` ${str} `
  const out = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

function similarity(a, b) {
  const x = normalizeText(a).replace(/\s+/g, ' ')
  const y = normalizeText(b).replace(/\s+/g, ' ')
  if (!x || !y) return 0
  if (x === y) return 1

  const A = bigrams(x)
  const B = bigrams(y)
  const pool = new Map()
  A.forEach(g => pool.set(g, (pool.get(g) || 0) + 1))
  let hits = 0
  for (const g of B) {
    const n = pool.get(g) || 0
    if (n > 0) { pool.set(g, n - 1); hits++ }
  }
  const dice = (2 * hits) / (A.length + B.length)

  /* Un texte contenu dans l'autre se ressemble d'autant plus qu'il en couvre
     une grande part : « Powerheart G5 » dans « Powerheart G5 Automatique »
     compte, la lettre « a » dans « raison sociale » non. */
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length)
    return Math.max(dice, 0.5 + 0.45 * ratio)
  }
  return dice
}

/* ── Conversions de cellules ─────────────────────────────────── */

const pad = n => String(n).padStart(2, '0')

/** Numéro de série Excel → 'aaaa-mm-jj', sans passer par un fuseau horaire. */
function serialToISO(serial) {
  const parsed = XLSX.SSF?.parse_date_code?.(serial)
  if (!parsed || !parsed.y) return null
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`
}

/**
 * Date d'une cellule → 'aaaa-mm-jj', '' si vide, `null` si illisible.
 *
 * `order` tranche les dates textuelles ambiguës : '03/09/2026' est le 3
 * septembre en 'dmy', le 9 mars en 'mdy'. La convention du fichier est
 * déduite en amont (voir `detectDateOrder`) et affichée avant l'import.
 */
function toISODate(value, order = 'dmy') {
  if (value == null || value === '') return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === 'number') {
    return value > 0 && value < 300000 ? serialToISO(value) : null
  }

  const str = String(value).trim()
  if (!str) return ''

  // 'aaaa-mm-jj' — jamais ambigu.
  const iso = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`

  const parts = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (parts) {
    const a = Number(parts[1])
    const b = Number(parts[2])
    const y = parts[3].length === 2 ? Number(`20${parts[3]}`) : Number(parts[3])
    // Une valeur > 12 ne peut être qu'un jour : elle l'emporte sur la convention.
    let day = a, month = b
    if (a > 12 && b <= 12)      { day = a; month = b }
    else if (b > 12 && a <= 12) { day = b; month = a }
    else if (order === 'mdy')   { day = b; month = a }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${y}-${pad(month)}-${pad(day)}`
  }

  // Numéro de série Excel arrivé sous forme de texte.
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = Number(str)
    if (n > 20000 && n < 80000) return serialToISO(n)
  }

  const parsed = new Date(str)
  if (Number.isNaN(parsed.getTime())) return null
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

/**
 * Convention de date du fichier, lue sur les cellules textuelles.
 *
 * Une seule date dont le premier nombre dépasse 12 suffit à trancher : ce ne
 * peut être qu'un jour. Sans indice, on reste sur jj/mm/aaaa — la convention
 * française — et l'écran d'import le dit clairement.
 */
function detectDateOrder(rows) {
  let dmy = 0, mdy = 0
  for (const row of rows) {
    for (const key of DATE_FIELDS) {
      const v = row[key]
      if (typeof v !== 'string') continue
      const m = v.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
      if (!m) continue
      const a = Number(m[1]), b = Number(m[2])
      if (a > 12 && b <= 12) dmy++
      else if (b > 12 && a <= 12) mdy++
    }
  }
  if (mdy > dmy) return { order: 'mdy', certain: true }
  if (dmy > 0)   return { order: 'dmy', certain: true }
  return { order: 'dmy', certain: false }
}

function toBool(value) {
  const v = normalizeText(value)
  if (!v) return undefined
  if (['oui', 'yes', 'true', 'vrai', '1', 'x', 'sous contrat', 'o'].includes(v)) return true
  if (['non', 'no', 'false', 'faux', '0', 'sans contrat', 'n'].includes(v)) return false
  return null   // valeur non reconnue
}

/**
 * Charge de la batterie en pourcentage. Excel range « 50 % » en 0,5 : une
 * fraction est donc remontée à l'échelle, un entier lu tel quel.
 */
function toPercent(value) {
  if (value === '' || value == null) return undefined
  if (typeof value === 'number') {
    return value > 0 && value <= 1 ? Math.round(value * 100) : value
  }
  const str = String(value).trim().replace('%', '').replace(',', '.').trim()
  if (!str) return undefined
  const n = Number(str)
  if (Number.isNaN(n)) return null
  return n > 0 && n <= 1 && String(str).includes('.') ? Math.round(n * 100) : n
}

/** Statut de pose : « installé » par défaut, l'import décrivant l'existant. */
function toDeaStatus(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (['installe', 'installee', 'pose', 'posee', 'actif', 'en service', 'ok', 'oui'].includes(v)) return 'installe'
  if (['a installer', 'a poser', 'planifie', 'planifiee', 'en attente'].includes(v)) return 'a_installer'
  return null   // valeur non reconnue
}

function toControlType(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (v.startsWith('semestr') || v === '6 mois') return 'semestriel'
  if (v.startsWith('annuel') || v.startsWith('annuelle') || v === 'an' || v === '12 mois') return 'annuel'
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

/**
 * En-têtes → clés internes. Un libellé inconnu est rapproché par ressemblance
 * de ceux que l'on connaît, au-dessus de 0,84 : « Nom du site client » tombe
 * ainsi sur « nom du site » plutôt que d'être ignoré.
 */
const ALIASES = Object.keys(COL_MAP)

function mapHeader(raw) {
  const norm = normalizeHeader(raw)
  if (!norm) return { key: null, match: null, norm }
  if (COL_MAP[norm]) return { key: COL_MAP[norm], match: 'exact', norm }
  // En deçà de quatre lettres, la ressemblance ne veut plus rien dire.
  if (norm.length < 4) return { key: null, match: null, norm }

  let best = null, bestScore = 0
  for (const alias of ALIASES) {
    const score = similarity(norm, alias)
    if (score > bestScore) { bestScore = score; best = alias }
  }
  if (best && bestScore >= 0.84) {
    return { key: COL_MAP[best], match: 'approx', norm, via: best, score: bestScore }
  }
  return { key: null, match: null, norm }
}

/**
 * Lit la première feuille. Les cellules sont laissées brutes (nombres pour les
 * dates et les pourcentages) : les convertir nous-mêmes évite le décalage d'un
 * jour que provoque le passage par un fuseau horaire.
 */
function parseSheet(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return { columns: [], rows: [] }

  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false })
  // Un fichier réduit à ses en-têtes reste lisible : on rend les colonnes, la
  // validation dira qu'il n'y a pas de données.
  if (!raw.length) return { columns: [], rows: [] }

  // Certains exports posent un titre avant le tableau : la première ligne qui
  // reconnaît au moins deux colonnes fait office d'en-tête.
  let headerIdx = 0
  for (let i = 0; i < Math.min(raw.length, 8); i++) {
    const known = raw[i].filter(c => mapHeader(c).key).length
    if (known >= 2) { headerIdx = i; break }
  }

  const headers = raw[headerIdx]
  const mapped  = headers.map(h => ({ header: String(h ?? '').trim(), ...mapHeader(h) }))

  // Deux colonnes pour le même champ : seule la première est lue, l'autre est
  // signalée plutôt que d'écraser silencieusement la première.
  const seen = new Set()
  const columns = mapped.map(c => {
    if (!c.key) return { ...c, ignored: !c.header ? 'vide' : 'inconnue' }
    if (seen.has(c.key)) return { ...c, key: null, ignored: 'doublon' }
    seen.add(c.key)
    return c
  })

  const rows = raw.slice(headerIdx + 1).map(r => {
    const obj = {}
    columns.forEach((c, i) => {
      if (!c.key) return
      const cell = r[i]
      obj[c.key] = (cell instanceof Date || typeof cell === 'number') ? cell : String(cell ?? '').trim()
    })
    return obj
  }).filter(r => Object.values(r).some(v => v !== '' && v != null))

  return { columns, rows }
}

/* ── Normalisation et validation d'une ligne ─────────────────── */

const DATE_FIELDS = ['deaInstallDate', 'deaNextControl', 'deaLastControl', 'battExpiry', 'elecExpiry']

/**
 * Ligne ramenée à des valeurs simples : chaînes propres et dates 'aaaa-mm-jj'.
 * Les dates sont figées dès la validation, si bien que la ligne renvoyée à
 * l'écran puis rejouée à l'import ne dépend plus d'Excel ni de la convention
 * du fichier.
 */
function normalizeRow(row, order = 'dmy') {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (DATE_FIELDS.includes(k)) { out[k] = v; continue }
    out[k] = typeof v === 'number' ? v : String(v ?? '').trim()
  }
  if (out.siteContactEmail) out.siteContactEmail = String(out.siteContactEmail).toLowerCase()

  for (const k of DATE_FIELDS) {
    if (out[k] === undefined || out[k] === '') continue
    const iso = toISODate(out[k], order)
    out[k] = iso === null ? `__INVALID__${out[k]}` : iso
  }

  if (out.battLevel !== undefined && out.battLevel !== '') {
    const pct = toPercent(out.battLevel)
    out.battLevel = pct === null ? `__INVALID__${out.battLevel}` : String(pct)
  }
  return out
}

function hasDea(row) {
  return DEA_KEYS.some(k => row[k] !== undefined && row[k] !== '')
}

/** Adresse effective du site : ses colonnes propres, puis les colonnes nues. */
function siteAddress(row) {
  return {
    street:      row.siteStreet || row.street || '',
    city:        row.siteCity   || row.city   || '',
    governorate: row.siteGovernorate || row.governorate || '',
  }
}

/** Adresse du client : ses colonnes propres, à défaut celles du site. */
function clientAddress(row) {
  return {
    street:      row.clientStreet || row.street || row.siteStreet || '',
    city:        row.clientCity   || row.city   || row.siteCity   || '',
    governorate: row.clientGovernorate || row.governorate || row.siteGovernorate || '',
  }
}

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
/* Une date du fichier n'a pas d'heure : on la pose à minuit UTC. Minuit local
   la ferait basculer la veille dès que le serveur tourne à l'ouest de
   Greenwich — un contrôle du 1er tomberait au 31. */
const asDate = iso => (iso ? new Date(`${iso}T00:00:00.000Z`) : null)

function validateRow(row, idx, order) {
  const r      = normalizeRow(row, order)
  const errors = []
  const warnings = []

  if (!r.name) errors.push('Nom du client obligatoire — la ligne ne peut être rattachée')

  if (r.siteContactEmail && !EMAIL_RE.test(r.siteContactEmail)) {
    errors.push(`Email du responsable invalide : « ${r.siteContactEmail} »`)
  }

  for (const [key, label] of [
    ['deaInstallDate', "Date d'installation"],
    ['deaNextControl', 'Date du prochain contrôle'],
    ['deaLastControl', 'Date du dernier contrôle'],
    ['battExpiry',     "DLC de la batterie"],
    ['elecExpiry',     "DLC des électrodes"],
  ]) {
    if (String(r[key] || '').startsWith('__INVALID__')) {
      errors.push(`${label} illisible : « ${String(r[key]).replace('__INVALID__', '')} » — attendu jj/mm/aaaa`)
    }
  }

  if (toDeaStatus(r.deaStatus) === null) {
    errors.push(`Statut du DAE inconnu : « ${r.deaStatus} » — attendu « installé » ou « à installer »`)
  }
  if (toControlType(r.deaControlType) === null) {
    errors.push(`Type de contrôle inconnu : « ${r.deaControlType} » — attendu « semestriel » ou « annuel »`)
  }
  if (toElectrodeKind(r.elecKind) === null) {
    errors.push(`Type d'électrodes inconnu : « ${r.elecKind} » — attendu « adulte » ou « enfant »`)
  }
  if (toBool(r.underContract) === null) {
    errors.push(`Colonne contrat non comprise : « ${r.underContract} » — attendu « oui » ou « non »`)
  }

  if (String(r.battLevel || '').startsWith('__INVALID__')) {
    errors.push(`Charge de la batterie illisible : « ${String(r.battLevel).replace('__INVALID__', '')} » — attendu un pourcentage`)
  } else if (r.battLevel !== undefined && r.battLevel !== '') {
    const lvl = Number(r.battLevel)
    if (lvl < 0 || lvl > 100) errors.push(`Charge de la batterie hors bornes : ${r.battLevel} (0 à 100)`)
    else if (lvl <= 25) warnings.push(`Batterie à ${lvl} % — remplacement à prévoir`)
  }

  // Un DAE décrit sans modèle ni numéro de série ne serait pas identifiable.
  if (hasDea(r) && !r.deaType && !r.deaSerial) {
    errors.push('DAE incomplet : renseignez au moins le modèle ou le numéro de série')
  }

  /* ── Avertissements : l'import passe, mais cela mérite un regard ── */
  const now = today()

  if (hasDea(r) && !r.deaSerial) {
    warnings.push('DAE sans numéro de série — il ne pourra pas être rapproché du stock')
  }
  if (hasDea(r) && !r.deaType) {
    warnings.push('DAE sans modèle — aucun produit du catalogue ne lui sera rattaché')
  }
  if (hasDea(r) && !r.deaInstallDate) {
    warnings.push("DAE sans date d'installation — le rythme des visites sera calé sur le dernier contrôle")
  }
  if (!r.siteName) {
    warnings.push(`Site non nommé — rattaché à « ${DEFAULT_SITE_NAME} »`)
  }

  const install = asDate(r.deaInstallDate)
  const last    = asDate(r.deaLastControl)
  const next    = asDate(r.deaNextControl)
  const battDlc = asDate(r.battExpiry)
  const elecDlc = asDate(r.elecExpiry)

  if (install && install > now) warnings.push("Date d'installation dans le futur")
  if (last && last > now)       warnings.push('Dernier contrôle daté dans le futur — vérifiez la colonne')
  if (last && install && last < install) {
    warnings.push("Dernier contrôle antérieur à l'installation")
  }
  if (next && last && next < last) {
    warnings.push('Prochain contrôle antérieur au dernier contrôle')
  }
  if (battDlc && battDlc < now) warnings.push(`Batterie périmée depuis le ${r.battExpiry}`)
  if (elecDlc && elecDlc < now) warnings.push(`Électrodes périmées depuis le ${r.elecExpiry}`)

  const addr = siteAddress(r)
  if (r.siteName && !addr.street && !addr.city) {
    warnings.push('Site sans adresse ni ville')
  }

  return {
    row: r,
    rowNum: idx + 2,
    errors,
    warnings,
    valid: errors.length === 0,
    // Repris tel quel par l'aperçu de l'écran d'import.
    siteName: r.siteName || DEFAULT_SITE_NAME,
    hasDea: hasDea(r),
  }
}

/* ── Modèles de DAE ──────────────────────────────────────────── */

/** Marque devinée dans un libellé de modèle (« POWERHEART G5 » → Powerheart). */
function guessBrand(label) {
  const n = normalizeText(label)
  const found = BRANDS.find(b => n.includes(normalizeText(b)))
  return found || ''
}

/**
 * Rapproche les modèles cités dans le fichier du catalogue.
 *
 * Un libellé qui ne correspond à aucun produit n'est pas une erreur : l'écran
 * d'import propose les modèles les plus ressemblants, et l'on tranche — le
 * rattacher à un modèle existant ou en créer un. C'est cette décision que
 * `execute` rejoue.
 */
async function resolveModels(results) {
  const labels = new Map()   // clé normalisée → { label, rows, count }
  for (const r of results) {
    const label = String(r.row.deaType || '').trim()
    if (!label) continue
    const key = normalizeText(label)
    if (!labels.has(key)) labels.set(key, { label, key, rows: [], count: 0 })
    const entry = labels.get(key)
    entry.count++
    if (entry.rows.length < 12) entry.rows.push(r.rowNum)
  }
  if (!labels.size) return { models: [], catalog: [] }

  const products = await Product.find({ isActive: { $ne: false } })
    .select('name brand reference category')
    .lean()

  const models = [...labels.values()].map(entry => {
    const exact = products.find(p => normalizeText(p.name) === entry.key)
      || products.find(p => p.reference && normalizeText(p.reference) === entry.key)

    const suggestions = exact ? [] : products
      .map(p => ({
        _id: String(p._id), name: p.name, brand: p.brand || '', category: p.category,
        // Un modèle de la catégorie des défibrillateurs part avec une longueur
        // d'avance : c'est bien un appareil que l'on cherche à retrouver.
        score: Math.min(1, similarity(entry.label, p.name) + (p.category === DEA_CATEGORY ? 0.08 : 0)),
      }))
      .filter(p => p.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return {
      label: entry.label,
      key: entry.key,
      count: entry.count,
      rows: entry.rows,
      matched: exact ? { _id: String(exact._id), name: exact.name, brand: exact.brand || '', category: exact.category } : null,
      suggestions,
      // Proposition par défaut de l'écran d'import.
      suggestedAction: exact ? 'link' : 'create',
      suggestedBrand: guessBrand(entry.label),
    }
  }).sort((a, b) => b.count - a.count)

  const catalog = products
    .filter(p => p.category === DEA_CATEGORY)
    .map(p => ({ _id: String(p._id), name: p.name, brand: p.brand || '', category: p.category }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  return { models, catalog }
}

/* ── Validation (simulation) ─────────────────────────────────── */

async function validate(req, res) {
  // Le fichier arrive dans le corps multipart de la requête ; un appelant qui
  // l'a déjà en main (script de reprise) le pose directement sur `req.file`.
  if (!req.file) {
    await new Promise((resolve, reject) =>
      upload(req, res, err => (err ? reject(err) : resolve()))
    )
  }

  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })

  let workbook
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false })
  } catch {
    return res.status(400).json({ message: 'Fichier Excel invalide ou corrompu.' })
  }

  /* Trois façons pour un fichier d'être inexploitable, trois messages : on dit
     ce qui manque, pas seulement que ça ne marche pas. */
  const { columns, rows } = parseSheet(workbook)
  const read = columns.filter(c => c.key)

  if (!read.length) {
    const seen = columns.map(c => c.header).filter(Boolean).slice(0, 12)
    return res.status(400).json({
      message: seen.length
        ? `Aucune colonne reconnue. En-têtes lus : ${seen.join(', ')}. Téléchargez le modèle pour retrouver les intitulés attendus.`
        : 'Aucun en-tête trouvé : la première ligne du fichier doit porter les noms de colonnes.',
    })
  }
  if (!columns.some(c => c.key === 'name')) {
    return res.status(400).json({
      message: 'Colonne « Client » introuvable : ajoutez une colonne « Client » (ou « Nom du client ») — c’est la seule vraiment obligatoire.',
    })
  }
  if (rows.length === 0) {
    return res.status(400).json({
      message: 'Les colonnes sont reconnues mais le fichier ne contient aucune ligne de données.',
    })
  }

  // La convention de date est déduite du fichier entier, pas ligne par ligne :
  // une seule date sans ambiguïté suffit à trancher pour toutes les autres.
  const forced   = String(req.body?.dateFormat || '').toLowerCase()
  const detected = detectDateOrder(rows)
  const order    = ['dmy', 'mdy'].includes(forced) ? forced : detected.order

  const results = rows.map((r, i) => validateRow(r, i, order))

  /* Un même numéro de série ne peut désigner deux appareils : on le signale sur
     toutes les lignes concernées plutôt que d'échouer à l'import. */
  const serialRows = {}
  results.forEach(r => {
    const sn = normalizeText(r.row.deaSerial)
    if (sn) (serialRows[sn] ||= []).push(r)
  })
  Object.values(serialRows).forEach(group => {
    if (group.length > 1) {
      group.forEach(r => {
        r.errors.push(`N° de série en double dans le fichier (lignes ${group.map(g => g.rowNum).join(', ')})`)
        r.valid = false
      })
    }
  })

  /* Deux DAE au même emplacement d'un site, sans numéro de série pour les
     distinguer : l'import les confondrait en un seul appareil. */
  const spots = {}
  results.forEach(r => {
    if (!r.hasDea || r.row.deaSerial) return
    const key = [normalizeText(r.row.name), normalizeText(r.siteName),
      normalizeText(r.row.deaType), normalizeText(r.row.deaLocation)].join('|')
    ;(spots[key] ||= []).push(r)
  })
  Object.values(spots).forEach(group => {
    if (group.length > 1) {
      group.forEach(r => r.warnings.push(
        `Même modèle au même emplacement que les lignes ${group.map(g => g.rowNum).join(', ')}, sans n° de série : ces lignes seront fusionnées en un seul DAE`
      ))
    }
  })

  /* Un site décrit avec deux adresses différentes : la dernière ligne lue
     l'emporterait, autant le dire. */
  const siteAddrs = {}
  results.forEach(r => {
    const key  = `${normalizeText(r.row.name)}|${normalizeText(r.siteName)}`
    const addr = siteAddress(r.row)
    if (!addr.street && !addr.city) return
    const val = `${normalizeText(addr.street)}|${normalizeText(addr.city)}`
    if (siteAddrs[key] && siteAddrs[key] !== val) {
      r.warnings.push('Adresse différente d’une autre ligne du même site — la dernière lue sera conservée')
    }
    siteAddrs[key] = val
  })

  /* Ce que la base sait déjà : clients et sites existants seront mis à jour,
     pas dupliqués ; un n° de série posé ailleurs mérite un avertissement. */
  const clientNames = [...new Set(results.filter(r => r.row.name).map(r => r.row.name.trim()))]
  const known = clientNames.length
    ? await Client.find({ $or: clientNames.map(n => ({ name: exactRe(n) })) }).select('name').lean()
    : []
  const knownClients = new Map(known.map(c => [normalizeText(c.name), c]))

  const knownSites = new Map()
  if (known.length) {
    const sites = await Site.find({ client: { $in: known.map(c => c._id) } }).select('name client').lean()
    const byId  = new Map(known.map(c => [String(c._id), c.name]))
    sites.forEach(s => knownSites.set(`${normalizeText(byId.get(String(s.client)))}|${normalizeText(s.name)}`, s))
  }

  const serials = results.map(r => String(r.row.deaSerial || '').trim()).filter(Boolean)
  const placed = {}
  if (serials.length) {
    const sites = await Site.find({ 'deas.serialNumber': { $in: serials } })
      .select('name client deas.serialNumber')
      .populate('client', 'name')
      .lean()
    sites.forEach(s => s.deas.forEach(d => {
      const sn = normalizeText(d.serialNumber)
      if (sn) placed[sn] = { site: s.name, client: s.client?.name || '' }
    }))
  }

  results.forEach(r => {
    const cKey = normalizeText(r.row.name)
    r.clientExists = knownClients.has(cKey)
    r.siteExists   = knownSites.has(`${cKey}|${normalizeText(r.siteName)}`)

    const at = placed[normalizeText(r.row.deaSerial)]
    if (at) {
      const sameSpot = normalizeText(at.site) === normalizeText(r.siteName)
      r.deaExists = sameSpot
      if (!sameSpot) {
        r.warnings.push(`N° de série déjà posé sur le site « ${at.site} »${at.client ? ` (${at.client})` : ''} — il y sera dupliqué`)
      }
    }
  })

  const { models, catalog } = await resolveModels(results.filter(r => r.valid))

  const valid = results.filter(r => r.valid)
  const uniq  = (list, fn) => new Set(list.map(fn).filter(Boolean)).size

  res.json({
    columns: columns.map(c => ({
      header: c.header,
      key: c.key,
      label: c.key ? FIELD_LABELS[c.key] : null,
      match: c.match || null,
      via: c.via || null,
      ignored: c.ignored || null,
    })),
    dateFormat: { order, certain: detected.certain, forced: ['dmy', 'mdy'].includes(forced) },
    models,
    catalog,
    results,
    summary: {
      total:   rows.length,
      valid:   valid.length,
      invalid: results.length - valid.length,
      clients:  uniq(valid, r => normalizeText(r.row.name)),
      sites:    uniq(valid, r => `${normalizeText(r.row.name)}|${normalizeText(r.siteName)}`),
      deas:     valid.filter(r => r.hasDea).length,
      warnings: results.filter(r => r.warnings.length > 0).length,
      newClients:  uniq(valid.filter(r => !r.clientExists), r => normalizeText(r.row.name)),
      newSites:    uniq(valid.filter(r => !r.siteExists), r => `${normalizeText(r.row.name)}|${normalizeText(r.siteName)}`),
      knownModels: models.filter(m => m.matched).length,
      newModels:   models.filter(m => !m.matched).length,
      ignoredColumns: columns.filter(c => c.ignored === 'inconnue').length,
    },
  })
}

/* ── Construction des documents ──────────────────────────────── */

/** Responsable du site : nom, téléphone, email — rien d'autre. */
function buildPerson(name, phone, email) {
  if (!name && !phone && !email) return null
  return { name: name || '', phone: phone || '', email: email || '' }
}

/** Champs client, sans les valeurs vides : un import partiel n'efface rien. */
function clientPatch(row) {
  const set  = { name: row.name }
  const addr = clientAddress(row)
  if (addr.street)      set['address.street']      = addr.street
  if (addr.city)        set['address.city']        = addr.city
  if (addr.governorate) set['address.governorate'] = addr.governorate
  if (row.notes)        set.notes                  = row.notes
  const contract = toBool(row.underContract)
  if (contract !== undefined && contract !== null) set.underContract = contract
  return set
}

/** Deux personnes se valent si nom, téléphone et email coïncident. */
function samePerson(a, b) {
  return normalizeText(a.name)  === normalizeText(b.name) &&
         normalizeText(a.phone) === normalizeText(b.phone) &&
         normalizeText(a.email) === normalizeText(b.email)
}

/**
 * Fusionne les responsables. Une fiche déjà connue par son nom se complète
 * (téléphone ou email ajoutés) au lieu d'être dupliquée : le même responsable
 * apparaît souvent avec le téléphone sur une ligne et sans sur la suivante.
 */
function mergePeople(existing = [], incoming = []) {
  const out = existing.map(p => (p.toObject ? p.toObject() : { ...p }))
  for (const p of incoming) {
    if (out.some(e => samePerson(e, p))) continue
    const byName = p.name && out.find(e => normalizeText(e.name) === normalizeText(p.name))
    if (byName) {
      if (p.phone && !byName.phone) byName.phone = p.phone
      if (p.email && !byName.email) byName.email = p.email
      continue
    }
    out.push(p)
  }
  return out
}

/** Retrouve le DAE d'un site : par n° de série, à défaut modèle + emplacement. */
function findDea(site, row) {
  const serial = normalizeText(row.deaSerial)
  if (serial) return site.deas.find(d => normalizeText(d.serialNumber) === serial)
  return site.deas.find(d => normalizeText(d.deviceType) === normalizeText(row.deaType) &&
                             normalizeText(d.location)   === normalizeText(row.deaLocation))
}

/**
 * Applique une ligne à un DAE du site : création s'il n'existe pas, mise à
 * jour sinon. Les cases vides du fichier ne suppriment rien.
 */
function upsertDea(site, row, productId) {
  let dea = findDea(site, row)

  const created = !dea
  if (created) {
    site.deas.push({ status: 'installe' })
    dea = site.deas[site.deas.length - 1]
  }

  const serial = String(row.deaSerial || '').trim()
  if (row.deaType)     dea.deviceType   = row.deaType
  if (serial)          dea.serialNumber = serial
  if (row.deaLocation) dea.location     = row.deaLocation
  if (row.deaNotes)    dea.notes        = row.deaNotes
  if (productId)       dea.product      = productId

  const status = toDeaStatus(row.deaStatus)
  if (status) dea.status = status

  const controlType = toControlType(row.deaControlType)
  if (controlType) dea.controlType = controlType

  if (row.deaInstallDate) {
    dea.installationDate = asDate(row.deaInstallDate)
    // Une date de pose renseignée signifie un appareil posé, sauf mention contraire.
    if (!status) dea.status = 'installe'
  }
  if (row.deaNextControl) dea.nextControlDate = asDate(row.deaNextControl)

  /* Batterie — reconnue par son numéro de série ou de lot, sinon la première. */
  if (row.battSerial || row.battLot || row.battExpiry || row.battLevel || row.battProductName) {
    const bSerial = String(row.battSerial || '').trim()
    const bLot    = String(row.battLot || '').trim()
    let batt = bSerial ? dea.batteries.find(b => normalizeText(b.serialNumber) === normalizeText(bSerial))
      : bLot ? dea.batteries.find(b => normalizeText(b.lotNumber) === normalizeText(bLot))
      : dea.batteries[0]
    if (!batt) {
      dea.batteries.push({})
      batt = dea.batteries[dea.batteries.length - 1]
    }
    if (bSerial)             batt.serialNumber = bSerial
    if (bLot)                batt.lotNumber    = bLot
    if (row.battProductName) batt.productName  = row.battProductName
    if (row.battExpiry)      batt.expiryDate   = asDate(row.battExpiry)
    if (row.battLevel !== undefined && row.battLevel !== '') batt.level = Number(row.battLevel)
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
    if (lot)                 elec.lotNumber   = lot
    if (kind)                elec.kind        = kind
    if (row.elecProductName) elec.productName = row.elecProductName
    if (row.elecExpiry)      elec.expiryDate  = asDate(row.elecExpiry)
  }

  return { dea, created }
}

/* ── Modèles : décisions rejouées ────────────────────────────── */

/**
 * Construit la table « libellé du fichier → modèle du catalogue » à partir des
 * décisions prises à l'écran. Un libellé sans décision est cherché au
 * catalogue ; s'il n'y est pas, le DAE gardera son libellé sans produit
 * rattaché — le parc reste juste, seul le lien au stock manque.
 */
async function buildModelMap(decisions, rows, userId) {
  const map     = new Map()
  const created = []

  const wanted = new Set(rows.map(r => normalizeText(r.deaType)).filter(Boolean))

  for (const d of (Array.isArray(decisions) ? decisions : [])) {
    const key = normalizeText(d.key || d.label)
    if (!key || !wanted.has(key)) continue

    if (d.action === 'skip') { map.set(key, null); continue }

    if (d.action === 'link' && d.productId) {
      const product = await Product.findById(d.productId).select('_id name').lean()
      if (product) { map.set(key, product._id); continue }
    }

    if (d.action === 'create') {
      const name = String(d.name || d.label || '').trim()
      if (!name) continue
      // Un modèle du même nom créé entre-temps est repris tel quel.
      let product = await Product.findOne({ name: exactRe(name) }).select('_id name')
      if (!product) {
        const category = d.category || DEA_CATEGORY
        // La catégorie doit exister : sinon le produit serait invisible du stock.
        const exists = await ProductCategory.findOne({ slug: category }).select('_id').lean()
        product = await Product.create({
          name,
          brand:     d.brand || guessBrand(name),
          reference: d.reference || '',
          category:  exists ? category : DEA_CATEGORY,
          requiresSerialNumber: true,
          stock: 0,
          notes: 'Modèle créé par l’import du parc',
          createdBy: userId,
        })
        created.push({ _id: String(product._id), name: product.name })
      }
      map.set(key, product._id)
    }
  }

  // Libellés sans décision : rapprochement au catalogue par le nom exact.
  for (const key of wanted) {
    if (map.has(key)) continue
    const label = rows.find(r => normalizeText(r.deaType) === key)?.deaType
    const product = await Product.findOne({ name: exactRe(label), isActive: { $ne: false } }).select('_id').lean()
    map.set(key, product?._id || null)
  }

  return { map, created }
}

/* ── Stock : l'appareil posé devient un exemplaire ───────────── */

/**
 * Rattache le DAE au stock. Si un exemplaire porte déjà ce numéro de série, il
 * est simplement mis au bon statut ; sinon il est créé, marqué installé chez
 * le client. Sans cet exemplaire, un appareil du parc n'existe nulle part dans
 * l'inventaire — et la fiche produit annonce un parc vide.
 */
async function attachStockItem(site, dea, userId) {
  if (!dea.product || !dea.serialNumber) return null

  const existing = await ProductItem.findOne({
    product: dea.product,
    serialNumber: dea.serialNumber,
  })
  if (existing) {
    await syncDeaWithItem(site, dea)
    return null
  }

  const product = await Product.findById(dea.product).select('category reference').lean()
  const item = await ProductItem.create({
    product:      dea.product,
    category:     product?.category || DEA_CATEGORY,
    reference:    product?.reference || '',
    serialNumber: dea.serialNumber,
    quantity:     1,
    status:       dea.status === 'installe' ? 'installe' : 'reserve',
    entryDate:    dea.installationDate || new Date(),
    client:       site.client,
    site:         site._id,
    dea:          dea._id,
    notes:        'Exemplaire repris par l’import du parc',
    history: [{
      action: 'Repris par l’import du parc',
      to: dea.status === 'installe' ? 'installe' : 'reserve',
      note: site.name, user: userId, date: new Date(),
    }],
    createdBy: userId,
  })
  return item
}

/* ── Planification des visites ───────────────────────────────── */

/** Nombre de mois entiers entre deux dates. */
function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

/**
 * Prochaines visites d'un site, calées sur le dernier contrôle.
 *
 * Le rythme reste celui du contrat de maintenance — une visite tous les six
 * mois, une sur deux valant contrôle annuel — mais l'ancre n'est plus la pose :
 * c'est la dernière visite réellement faite, seule date fiable sur un parc
 * repris des années après son installation. La parité (semestriel / annuel)
 * continue, elle, de se compter depuis la pose quand on la connaît, pour que
 * le contrôle annuel tombe bien à l'anniversaire.
 *
 * Aucune visite n'est planifiée dans le passé : les visites manquées sont de
 * l'histoire, pas du planning.
 */
function planDates({ lastControl, installDate, nextControl, controlType }, horizonMonths) {
  const now      = today()
  const anchor   = lastControl || installDate
  const horizon  = addMonths(now, horizonMonths)
  const out      = []

  /* Une date de prochain contrôle donnée par le fichier fait foi : le terrain
     sait mieux que la règle. */
  if (nextControl) {
    const d = new Date(nextControl)
    d.setHours(9, 0, 0, 0)
    if (d >= now) out.push({ date: d, type: controlType || typeAt(installDate || anchor, d) })
  }

  if (!anchor) return out

  for (let i = 1; i <= 40; i++) {
    const raw = addMonths(anchor, i * PERIOD_MONTHS)
    if (raw > horizon) break
    const date = skipWeekend(raw)
    date.setHours(9, 0, 0, 0)
    if (date < now) continue
    if (out.some(o => Math.abs(o.date - date) < 20 * 86400000)) continue
    out.push({ date, type: controlType || typeAt(installDate || anchor, raw) })
  }
  return out
}

/** Semestriel ou annuel : une visite sur deux depuis la pose est annuelle. */
function typeAt(anchor, date) {
  if (!anchor) return 'semestriel'
  const n = Math.round(monthsBetween(new Date(anchor), new Date(date)) / PERIOD_MONTHS)
  return n % 2 === 0 ? 'annuel' : 'semestriel'
}

const dayKey = d => new Date(d).toISOString().slice(0, 10)

/**
 * Écrit dans le planning ce que le fichier raconte du site : la dernière visite
 * comme visite faite, les suivantes comme visites à venir.
 *
 * Une visite couvre le site entier — tous ses appareils partagent donc le même
 * calendrier, et l'on ne crée qu'une intervention par échéance. Les visites
 * portent `manualDate` : elles viennent d'un relevé de terrain, pas du
 * calendrier théorique d'un contrat, et ne doivent pas être balayées par lui.
 */
async function planSiteControls(site, siteRows, opts, userId) {
  const out = { planned: 0, history: 0 }
  if (!opts.planControls) return out

  const dates = rows => rows.map(r => asDate(r)).filter(Boolean)
  const lasts     = dates(siteRows.map(r => r.deaLastControl))
  const installs  = dates(siteRows.map(r => r.deaInstallDate))
  const nexts     = dates(siteRows.map(r => r.deaNextControl))

  const lastControl = lasts.length    ? new Date(Math.max(...lasts))    : null
  const installDate = installs.length ? new Date(Math.min(...installs)) : null
  const nextControl = nexts.length    ? new Date(Math.min(...nexts))    : null
  const controlType = siteRows.map(r => toControlType(r.deaControlType)).find(Boolean) || ''

  if (!lastControl && !installDate && !nextControl) return out

  const existing = await Intervention.find({ site: site._id })
    .select('scheduledDate status')
    .lean()
  const takenDays = new Set(existing.map(i => (i.scheduledDate ? dayKey(i.scheduledDate) : null)).filter(Boolean))

  const client = await Client.findById(site.client).select('name').lean()
  const base = {
    client: site.client, clientName: client?.name || '',
    site: site._id, siteName: site.name,
    manualDate: true, createdBy: userId,
  }

  const docs = []

  /* La dernière visite connue entre au planning comme visite faite : c'est
     elle qui justifie la date de la suivante. */
  const lastVisit = lastControl ? new Date(lastControl) : null
  if (lastVisit) lastVisit.setHours(9, 0, 0, 0)

  if (opts.recordLastControl && lastVisit && !takenDays.has(dayKey(lastVisit))) {
    const d = lastVisit
    docs.push({
      ...base,
      controlType: controlType || typeAt(installDate, d),
      status: 'termine',
      scheduledDate: d,
      completedDate: d,
      notes: 'Visite reprise de l’import du parc (dernier contrôle déclaré).',
      history: [{ action: 'import', user: userId, date: new Date(), details: 'Dernier contrôle repris du fichier importé' }],
    })
    takenDays.add(dayKey(d))
    out.history++
  }

  for (const p of planDates({ lastControl, installDate, nextControl, controlType }, opts.horizonMonths)) {
    if (takenDays.has(dayKey(p.date))) continue
    takenDays.add(dayKey(p.date))
    docs.push({
      ...base,
      controlType: p.type,
      status: 'planifie',
      scheduledDate: p.date,
      history: [{
        action: 'creation', user: userId, date: new Date(),
        details: lastControl
          ? `Contrôle ${p.type} planifié à l’import, six mois après le dernier contrôle`
          : `Contrôle ${p.type} planifié à l’import, six mois après la pose`,
      }],
    })
    out.planned++
  }

  if (docs.length) await Intervention.insertMany(docs)
  // La fiche des DAE reprend la première visite à venir du site.
  await syncSiteNextControl(site._id)
  return out
}

/* ── Import réel ─────────────────────────────────────────────── */

async function execute(req, res) {
  const { rows, models: decisions, options } = req.body
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne à importer.' })
  }

  const opts = {
    planControls:     options?.planControls     !== false,
    recordLastControl: options?.recordLastControl !== false,
    createStockItems: options?.createStockItems !== false,
    horizonMonths:    Number(options?.horizonMonths) > 0
      ? Math.min(Number(options.horizonMonths), 36)
      : DEFAULT_HORIZON_MONTHS,
  }

  // Les dates arrivent déjà en 'aaaa-mm-jj' : la convention du fichier a été
  // tranchée à la validation, l'import ne la rejoue pas.
  const normalized = rows.map(r => normalizeRow(r, 'dmy')).filter(r => r.name)
  if (!normalized.length) {
    return res.status(400).json({ message: 'Aucune ligne exploitable : le nom du client est absent partout.' })
  }

  let modelMap, modelsCreated
  try {
    const built   = await buildModelMap(decisions, normalized, req.user._id)
    modelMap      = built.map
    modelsCreated = built.created
  } catch (err) {
    return res.status(400).json({ message: `Modèles de DAE : ${err.message}` })
  }

  /* Regroupement client → site → lignes : un client réparti sur plusieurs
     lignes n'est traité qu'une fois. */
  const clients = new Map()
  for (const row of normalized) {
    const cKey = normalizeText(row.name)
    if (!clients.has(cKey)) clients.set(cKey, { name: row.name, rows: [], sites: new Map() })
    const entry = clients.get(cKey)
    entry.rows.push(row)

    const sName = row.siteName || DEFAULT_SITE_NAME
    const sKey  = normalizeText(sName)
    if (!entry.sites.has(sKey)) entry.sites.set(sKey, { name: sName, rows: [] })
    entry.sites.get(sKey).rows.push(row)
  }

  const results = []

  for (const entry of clients.values()) {
    try {
      /* ── Client ──
         Les lignes sont fusionnées de la dernière vers la première : la
         première ligne du client l'emporte, les suivantes ne servent qu'à
         combler ce qu'elle laisse vide. Sans cela, un client réparti sur dix
         sites héritait de l'adresse du dixième. */
      const set = Object.assign({}, ...entry.rows.slice().reverse().map(clientPatch))

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
      let itemsCreated = 0, controlsPlanned = 0, controlsHistory = 0
      const notes = []

      for (const siteEntry of entry.sites.values()) {
        let site = await Site.findOne({ client: client._id, name: exactRe(siteEntry.name) })
        if (!site) {
          site = new Site({ client: client._id, name: siteEntry.name, createdBy: req.user._id })
          sitesCreated++
        }

        for (const row of siteEntry.rows) {
          const addr = siteAddress(row)
          if (addr.street)      site.address.street      = addr.street
          if (addr.city)        site.address.city        = addr.city
          if (addr.governorate) site.address.governorate = addr.governorate
          if (row.siteNotes)    site.notes               = row.siteNotes

          const contact = buildPerson(row.siteContactName, row.siteContactPhone, row.siteContactEmail)
          if (contact) site.contacts = mergePeople(site.contacts, [contact])

          if (hasDea(row)) {
            const productId = modelMap.get(normalizeText(row.deaType)) || null
            const { created } = upsertDea(site, row, productId)
            if (created) deasCreated++; else deasUpdated++
          }
        }

        await site.save()

        // Une fois le site enregistré, les DAE ont un _id : le stock peut suivre.
        for (const row of siteEntry.rows) {
          if (!hasDea(row)) continue
          const dea = findDea(site, row)
          if (!dea) continue
          try {
            if (opts.createStockItems) {
              const item = await attachStockItem(site, dea, req.user._id)
              if (item) { itemsCreated++; await syncProductStock(item.product) }
            } else {
              await syncDeaWithItem(site, dea)
            }
          } catch (err) {
            notes.push(`Stock non mis à jour pour ${dea.serialNumber || dea.deviceType} : ${err.message}`)
          }
        }

        try {
          const planned = await planSiteControls(site, siteEntry.rows, opts, req.user._id)
          controlsPlanned += planned.planned
          controlsHistory += planned.history
        } catch (err) {
          notes.push(`Visites non planifiées pour « ${site.name} » : ${err.message}`)
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
        itemsCreated,
        controlsPlanned,
        controlsHistory,
        notes,
      })
    } catch (err) {
      results.push({ name: entry.name, success: false, error: err.message })
    }
  }

  const sum = key => results.reduce((n, r) => n + (r[key] || 0), 0)
  res.json({
    results,
    modelsCreated,
    summary: {
      imported: results.filter(r => r.success).length,
      created:  results.filter(r => r.action === 'created').length,
      updated:  results.filter(r => r.action === 'updated').length,
      failed:   results.filter(r => !r.success).length,
      sitesCreated:    sum('sitesCreated'),
      deasCreated:     sum('deasCreated'),
      deasUpdated:     sum('deasUpdated'),
      itemsCreated:    sum('itemsCreated'),
      controlsPlanned: sum('controlsPlanned'),
      controlsHistory: sum('controlsHistory'),
      modelsCreated:   modelsCreated.length,
    },
  })
}

module.exports = { validate, execute }
