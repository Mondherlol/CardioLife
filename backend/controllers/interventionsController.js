const path           = require('path')
const fs             = require('fs')
const Intervention   = require('../models/Intervention')
const Site           = require('../models/Site')
const { listInstallations } = require('../utils/deaParc')
const { syncSiteNextControl } = require('../utils/controls')
const { syncFicheToParc } = require('../utils/ficheSync')
const { syncDeaWithItem, syncDeaConsumables } = require('../utils/productItems')

const ADMIN_ROLES = ['superadmin', 'admin']

/**
 * Réaligne l'échéance affichée sur les DAE du site après un changement de visite.
 *
 * `Site.deas[].nextControlDate` est une copie de la date de la prochaine visite,
 * tenue là pour que la fiche client l'affiche sans jointure. Toute écriture qui
 * déplace cette prochaine visite — clôture, report, création, suppression — doit
 * donc la rafraîchir. Sans ça la fiche client reste bloquée sur la visite qu'on
 * vient de terminer, et annonce indéfiniment une date passée.
 *
 * Les échéances fixées à la main ne sont pas touchées : `syncSiteNextControl`
 * les laisse tranquilles.
 *
 * La copie n'est qu'un cache : son échec ne doit pas faire échouer une visite
 * déjà enregistrée. On le trace, et `scripts/resyncControls.js` la reconstruit.
 */
async function refreshNextControl(intervention) {
  try {
    let siteId = intervention?.site
    // Visites d'avant les sites : seul l'appareil est connu, le site se déduit.
    if (!siteId && intervention?.installation) {
      const site = await Site.findOne({ 'deas._id': intervention.installation }).select('_id').lean()
      siteId = site?._id
    }
    if (siteId) await syncSiteNextControl(siteId)
  } catch (err) {
    console.error('Échéance du site non rafraîchie :', err.message)
  }
}

function isAdmin(user) {
  return ADMIN_ROLES.includes(user.role) || user.permissions?.canManageInterventions
}

/**
 * Qui peut écrire dans la checklist d'une visite.
 *
 * Le technicien assigné, d'abord : c'est lui qui est sur place. Et le
 * superadmin, qui régularise une visite faite mais non saisie — technicien
 * parti, tablette hors service — sans renvoyer personne sur site.
 *
 * Une fois la visite clôturée, la main passe à l'administration : une erreur
 * de saisie relevée après coup (péremption inversée, pourcentage erroné) se
 * corrige au bureau, alors que le technicien, lui, ne revient plus sur une
 * fiche qu'il a validée. Chaque correction post-clôture est tracée dans
 * l'historique — voir `logCorrection`.
 */
function canWriteFiche(user, intervention) {
  if (user.role === 'superadmin') return true
  if (intervention.status === 'termine') return isAdmin(user)
  return String(intervention.technicien || '') === String(user._id)
}

/**
 * Libellés et mise en forme des champs de la checklist.
 *
 * L'historique d'une correction ne vaut que s'il dit *ce qui* a changé : une
 * ligne « Checklist corrigée » n'est pas auditable. On y écrit donc l'ancienne
 * et la nouvelle valeur, dans les mêmes mots que la fiche papier.
 */
const FICHE_LABELS = {
  deaLabel: 'Appareil', serialNumber: 'N° de série', emplacement: 'Emplacement',
  signaletique: 'Signalétique',

  batteriePeremption: 'Péremption batterie', batteriePct: 'Niveau batterie',
  batterieEtat: 'État batterie', batterieRemplacee: 'Batterie remplacée',
  batterieRemplaceeRef: 'Réf. batterie posée', batterieNote: 'Note batterie',

  electrodesPeremptionAdulte: 'Péremption électrodes adulte',
  electrodesPeremptionPediatrique: 'Péremption électrodes pédiatriques',
  electrodesEmballage: 'Emballage électrodes', electrodesAdaptees: 'Électrodes adaptées',
  electrodesType: "Type d'électrodes", electrodesRemplacees: 'Électrodes remplacées',
  electrodesRemplaceesRef: 'Réf. électrodes posées', electrodesPct: 'Niveau électrodes',
  electrodesNote: 'Note électrodes',

  kitGants: 'Kit — gants', kitCiseaux: 'Kit — ciseaux', kitRasoir: 'Kit — rasoir',
  kitMasque: 'Kit — masque', kitCompresses: 'Kit — compresses',
  kitRemplace: 'Kit remplacé', kitRemplaceRef: 'Réf. kit posé',

  voyantVert: 'Voyant vert', autotests: 'Autotests', armoire: 'Armoire',
  armoireAccessible: 'Armoire accessible', armoirePiles: 'Piles armoire',

  dernierControle: 'Dernier contrôle', prochainControle: 'Prochain contrôle',
  observation: 'Observation',

  dateReception: 'Date de réception', visa: 'Visa',
  observationGenerale: 'Observation générale',
}

const DATE_FIELDS = new Set([
  'batteriePeremption', 'electrodesPeremptionAdulte', 'electrodesPeremptionPediatrique',
  'dernierControle', 'prochainControle', 'dateReception',
])
const PCT_FIELDS  = new Set(['batteriePct', 'electrodesPct'])
/* Trois familles de booléens, trois vocabulaires : une pièce est posée ou non,
   un accessoire est là ou non, un point de contrôle est conforme ou non. */
const YESNO_FIELDS    = new Set(['batterieRemplacee', 'electrodesRemplacees', 'kitRemplace'])
const PRESENCE_FIELDS = new Set(['kitGants', 'kitCiseaux', 'kitRasoir', 'kitMasque', 'kitCompresses'])

const ELECTRODE_TYPE_LABELS = {
  capteur_rcp: 'Avec capteur RCP',
  sans_capteur_rcp: 'Sans capteur RCP',
  universelle: 'Universelle',
}

function fmtHistValue(field, v) {
  if (v === undefined || v === null || v === '') return 'vide'
  if (typeof v === 'boolean') {
    if (YESNO_FIELDS.has(field))    return v ? 'oui' : 'non'
    if (PRESENCE_FIELDS.has(field)) return v ? 'présent' : 'absent'
    return v ? 'conforme' : 'non conforme'
  }
  if (DATE_FIELDS.has(field)) {
    const d = new Date(v)
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
  }
  if (PCT_FIELDS.has(field)) return `${v} %`
  if (field === 'electrodesType') return ELECTRODE_TYPE_LABELS[v] || String(v)
  // Le séparateur de l'historique ne doit pas se retrouver dans une valeur :
  // il découperait la note saisie en fausses lignes de correction.
  const str = String(v).trim().replace(/ · /g, ' - ').replace(/ → /g, ' -> ')
  // Une observation entière rendrait la ligne d'historique illisible.
  return str.length > 60 ? `${str.slice(0, 60)}…` : str
}

/** Égalité tolérante : une date relue de Mongo et sa chaîne ISO sont la même. */
function sameHistValue(a, b) {
  const empty = v => v === undefined || v === null || v === ''
  if (empty(a) && empty(b)) return true
  if (empty(a) !== empty(b)) return false
  if (a instanceof Date || b instanceof Date) {
    const da = new Date(a), db = new Date(b)
    if (!isNaN(da.getTime()) && !isNaN(db.getTime())) return da.getTime() === db.getTime()
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b)
  return String(a) === String(b)
}

/** « Libellé : avant → après » — la forme lue et fusionnée par l'historique. */
function describeChange(field, before, after, prefix = '') {
  const label = FICHE_LABELS[field] || field
  return `${prefix}${label} : ${fmtHistValue(field, before)} → ${fmtHistValue(field, after)}`
}

const CHANGE_SEP = ' · '
const ARROW      = ' → '

/**
 * Fusionne deux jeux de corrections en gardant, par champ, la valeur d'origine
 * et la dernière valeur saisie. Sans ça, corriger un même champ deux fois de
 * suite laisserait dans l'historique un état intermédiaire qui n'a jamais été
 * celui du rapport.
 */
function mergeChangeDetails(previous, changes) {
  const kept = (previous || '').split(CHANGE_SEP).filter(Boolean)

  changes.forEach(change => {
    // Les mentions libres (photo ajoutée, fiche retirée) s'empilent telles quelles.
    if (!change.includes(ARROW)) {
      if (!kept.includes(change)) kept.push(change)
      return
    }
    const label = change.slice(0, change.indexOf(' : ') + 3)
    const idx   = kept.findIndex(part => part.includes(ARROW) && part.startsWith(label))
    if (idx === -1) { kept.push(change); return }
    // Valeur d'origine de la première correction + valeur finale de celle-ci.
    const origin = kept[idx].slice(0, kept[idx].indexOf(ARROW))
    kept[idx] = `${origin}${ARROW}${change.slice(change.indexOf(ARROW) + ARROW.length)}`
  })

  return kept.join(CHANGE_SEP)
}

/**
 * Trace une modification faite après la clôture.
 *
 * La checklist s'enregistre champ par champ : une ligne d'historique par
 * frappe rendrait l'historique illisible. On regroupe donc les corrections
 * d'un même auteur en une seule entrée tant qu'elles s'enchaînent, en y
 * accumulant le détail des champs touchés.
 */
const CORRECTION_WINDOW_MS = 30 * 60 * 1000

function logCorrection(intervention, user, changes) {
  if (intervention.status !== 'termine') return

  const list = (Array.isArray(changes) ? changes : [changes]).filter(Boolean)
  // Un enregistrement qui ne change rien (sortie de champ sans saisie) ne
  // mérite pas de ligne d'historique.
  if (!list.length) return

  const last = intervention.history[intervention.history.length - 1]
  const groupable = last && last.action === 'correction'
    && String(last.user || '') === String(user._id)
    && Date.now() - new Date(last.date).getTime() < CORRECTION_WINDOW_MS

  if (groupable) {
    last.details = mergeChangeDetails(last.details, list)
    last.date    = new Date()
    intervention.markModified('history')
    return
  }

  intervention.history.push({
    action:   'correction',
    user:     user._id,
    userName: user.fullName || user.username,
    details:  list.join(CHANGE_SEP),
  })
}

/**
 * Parc du site visité, joint à la fiche d'intervention.
 *
 * `installation` n'est plus une collection : c'est l'_id d'un sous-document de
 * `Site.deas`, qu'aucun populate ne peut résoudre — on passe donc par le site.
 *
 * Les contrôles générés par un contrat portent sur le site entier et ne visent
 * aucun appareil : sans cette liste, le technicien devrait ressaisir à la main
 * un numéro de série que l'application connaît déjà.
 */
async function parcOf(intervention) {
  const empty = { deviceProduct: null, siteDeas: [] }
  if (!intervention.site) return empty

  const site = await Site.findById(intervention.site._id || intervention.site)
    .select('deas')
    .populate('deas.product', 'name images')
  if (!site) return empty

  const siteDeas = (site.deas || []).map(d => ({
    _id:          d._id,
    deviceType:   d.deviceType,
    serialNumber: d.serialNumber,
    location:     d.location,
    product:      d.product ? { name: d.product.name, images: d.product.images } : null,
    /* Les consommables montés sur l'appareil : la checklist ne contrôle l'état
       d'une batterie que si le parc dit laquelle est en place. */
    batteries:  (d.batteries || []).map(b => ({
      _id: b._id, productName: b.productName, serialNumber: b.serialNumber,
      lotNumber: b.lotNumber, expiryDate: b.expiryDate, level: b.level,
    })),
    electrodes: (d.electrodes || []).map(e => ({
      _id: e._id, productName: e.productName, kind: e.kind,
      lotNumber: e.lotNumber, expiryDate: e.expiryDate,
    })),
  }))

  // L'appareil visé, s'il y en a un ; à défaut le seul du site, qui ne laisse
  // place à aucune ambiguïté.
  const target = intervention.installation
    ? site.deas.id(intervention.installation)
    : (site.deas?.length === 1 ? site.deas[0] : null)

  return { deviceProduct: target?.product || null, siteDeas }
}

/* ─── List ─────────────────────────────────────────────────── */
async function getAll(req, res) {
  try {
    const { status, technicien, client, search, from, to, installation, controlType, contract } = req.query
    const query = {}

    // Technicians only see their own interventions
    if (req.user.role === 'technicien') {
      query.technicien = req.user._id
    } else {
      if (technicien) query.technicien = technicien
      if (client)     query.client     = client
    }

    if (status)       query.status       = status
    if (installation) query.installation = installation
    if (controlType)  query.controlType  = controlType
    if (contract)     query.contract     = contract

    // Plage de dates (utilisé par le planning) — sur la date planifiée
    if (from || to) {
      query.scheduledDate = {}
      if (from) query.scheduledDate.$gte = new Date(from)
      if (to)   query.scheduledDate.$lte = new Date(to)
    }

    if (search) {
      const re = { $regex: search, $options: 'i' }
      query.$or = [
        { clientName: re },
        { 'installationSnap.deviceType':   re },
        { 'installationSnap.serialNumber': re },
        { 'installationSnap.address':      re },
        { technicienName: re },
      ]
    }

    const interventions = await Intervention.find(query)
      .sort({ scheduledDate: -1 })
      .populate('technicien', 'fullName username')
      .populate('client', 'name')
      .lean()

    res.json(interventions)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Single ────────────────────────────────────────────────── */
async function getOne(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
      .populate('technicien', 'fullName username')
      .populate('client', 'name')
      // `installation` n'est plus une collection : c'est l'_id d'un DEA dans
      // `Site.deas`, donc rien à peupler. Le site, lui, se peuple, et c'est par
      // lui qu'on remonte au parc ; l'appareil est décrit par `installationSnap`.
      .populate('site', 'name address')
      .populate('contract', 'contractNumber status')
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Technician can only view their own
    if (req.user.role === 'technicien' &&
        String(intervention.technicien?._id || intervention.technicien) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    // Le parc du site vit deux niveaux plus loin (site → DEA → produit) : on le
    // joint ici plutôt que de le figer dans le snapshot, qui deviendrait faux au
    // moindre changement de photo ou de parc.
    const json = intervention.toObject()
    const { deviceProduct, siteDeas } = await parcOf(intervention)
    json.deviceProduct = deviceProduct
    json.siteDeas      = siteDeas

    // Fiches d'avant les visites multi-DAE : présentées comme une liste d'une
    // seule entrée, pour que l'écran n'ait qu'une forme à connaître.
    if (!json.fiches?.length && ficheHasContent(json.fiche)) {
      json.fiches = [{ ...json.fiche, dea: json.installation || null }]
    }
    if (!json.visite || !Object.values(json.visite).some(Boolean)) {
      const f = json.fiche || {}
      json.visite = {
        dateReception:       f.dateReception,
        visa:                f.visa,
        observationGenerale: f.observationGenerale,
      }
    }

    res.json(json)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Create ────────────────────────────────────────────────── */
async function create(req, res) {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

    const {
      client, clientName,
      site, siteName,
      installation, installationSnap,
      technicien, technicienName,
      scheduledDate, notes,
      controlType, contract,
    } = req.body

    const CONTROL_TYPES = ['semestriel', 'annuel', 'hors_contrat']

    const intervention = await Intervention.create({
      client, clientName,
      // Le site porte le contexte du contrôle (adresse, parc) : sans lui, la
      // fiche ne sait plus où la visite a lieu.
      site: site || undefined, siteName,
      installation, installationSnap,
      technicien, technicienName,
      scheduledDate, notes,
      controlType: CONTROL_TYPES.includes(controlType) ? controlType : 'hors_contrat',
      contract: contract || undefined,
      status: 'planifie',
      history: [{
        action:   'creation',
        user:     req.user._id,
        userName: req.user.fullName || req.user.username,
        details:  'Intervention créée',
      }],
      createdBy: req.user._id,
    })

    await refreshNextControl(intervention)
    res.status(201).json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Update (admin) ────────────────────────────────────────── */
async function update(req, res) {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Build descriptive change log before applying mutations
    const changed = []
    if (req.body.scheduledDate !== undefined) {
      const oldD = intervention.scheduledDate
        ? new Date(intervention.scheduledDate).toLocaleDateString('fr-FR')
        : 'Non définie'
      const newD = req.body.scheduledDate
        ? new Date(req.body.scheduledDate).toLocaleDateString('fr-FR')
        : 'Non définie'
      if (oldD !== newD) changed.push(`Date planifiée : ${oldD} → ${newD}`)
    }
    if (req.body.technicienName !== undefined || req.body.technicien !== undefined) {
      const oldT = intervention.technicienName || 'Non assigné'
      const newT = req.body.technicienName || 'Non assigné'
      if (oldT !== newT) changed.push(`Technicien : ${oldT} → ${newT}`)
    }
    if (req.body.notes !== undefined) {
      const hadNotes = !!(intervention.notes || '').trim()
      const hasNotes = !!(req.body.notes || '').trim()
      if (!hadNotes && hasNotes)                   changed.push('Notes ajoutées')
      else if (hadNotes && !hasNotes)              changed.push('Notes supprimées')
      else if (hadNotes && hasNotes)               changed.push('Notes modifiées')
    }

    const allowed = ['client','clientName','installation','installationSnap',
                     'technicien','technicienName','scheduledDate','notes','status','controlType','contract']
    allowed.forEach(k => { if (req.body[k] !== undefined) intervention[k] = req.body[k] })

    intervention.history.push({
      action:   'modification',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  changed.length ? changed.join(' · ') : 'Intervention modifiée',
    })

    await intervention.save()
    await refreshNextControl(intervention)
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/**
 * Reporte la visite sur le parc du site, et trace ce qui a bougé.
 *
 * Ce que le technicien constate sur place n'a de valeur que s'il arrive
 * jusqu'à la fiche client : c'est elle qu'on consulte pour appeler un client
 * avant une péremption. La trace, elle, dit d'où vient la donnée affichée —
 * sans quoi une fiche client qui change toute seule est incompréhensible.
 */
async function pushFicheToParc(intervention, user) {
  const changes = await syncFicheToParc(intervention, user)
  if (!changes.length) return
  intervention.history.push({
    action:   'sync_parc',
    user:     user?._id,
    userName: user?.fullName || user?.username,
    details:  changes.join(' · '),
  })
  await intervention.save()
}

/* ─── Submit rapport (technicien) ───────────────────────────── */
async function submitRapport(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Technician can only fill their own
    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    intervention.rapport = req.body.rapport || req.body
    intervention.status  = 'termine'
    intervention.completedDate = new Date()

    intervention.history.push({
      action:   'rapport_soumis',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  'Fiche d\'intervention remplie et soumise',
    })

    await intervention.save()
    // La visite est faite : le parc reprend ce qui a été constaté, et
    // l'échéance du site passe à la suivante.
    await pushFicheToParc(intervention, req.user)
    await refreshNextControl(intervention)
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Save fiche (auto-save) ───────────────────────────────── */
/* Champs acceptés depuis la fiche — l'ordre suit la checklist papier. */
const FICHE_FIELDS = [
  'deaLabel', 'serialNumber', 'emplacement', 'signaletique',
  // Batterie
  'batteriePeremption', 'batteriePct', 'batterieEtat', 'batterieRemplacee',
  'batterieRemplaceeRef', 'batterieNote',
  // Électrodes
  'electrodesPeremptionAdulte', 'electrodesPeremptionPediatrique',
  'electrodesEmballage', 'electrodesAdaptees', 'electrodesType', 'electrodesRemplacees',
  'electrodesRemplaceesRef', 'electrodesPct', 'electrodesNote',
  // Kit de secours
  'kitGants', 'kitCiseaux', 'kitRasoir', 'kitMasque', 'kitCompresses',
  'kitRemplace', 'kitRemplaceRef',
  // État général
  'voyantVert', 'autotests', 'armoire', 'armoireAccessible', 'armoirePiles',
  // Suivi documentaire
  'dernierControle', 'prochainControle',
  'observation',
]

/* Ce qui appartient à la visite et non à un appareil : saisi une seule fois,
   quel que soit le nombre de DAE contrôlés. */
const VISITE_FIELDS = ['dateReception', 'visa', 'observationGenerale']

/** Une fiche vierge ne compte pas : c'est le défaut du modèle, pas une saisie. */
function ficheHasContent(f) {
  if (!f) return false
  const obj = typeof f.toObject === 'function' ? f.toObject() : f
  return Object.entries(obj).some(([k, v]) => {
    if (['_id', 'dea', 'deaLabel'].includes(k)) return false
    if (Array.isArray(v)) return v.length > 0
    return v !== undefined && v !== null && v !== ''
  })
}

/**
 * Reprend l'unique fiche des interventions d'avant les visites multi-DAE comme
 * première entrée de la liste. Sans quoi la première sauvegarde en créerait une
 * seconde, à côté, et le travail déjà saisi disparaîtrait de l'écran.
 */
function ensureFiches(intervention) {
  if (intervention.fiches?.length) return
  if (!ficheHasContent(intervention.fiche)) return
  const legacy = intervention.fiche.toObject ? intervention.fiche.toObject() : { ...intervention.fiche }
  intervention.fiches.push({ ...legacy, dea: intervention.installation || undefined })
}

/** Fiche de cet appareil, créée à la volée au premier champ saisi. */
function ficheFor(intervention, deaId) {
  const key = deaId ? String(deaId) : ''
  let entry = intervention.fiches.find(f => String(f.dea || '') === key)
  if (!entry) {
    intervention.fiches.push({ dea: deaId || undefined })
    entry = intervention.fiches[intervention.fiches.length - 1]
  }
  return entry
}

/* Le miroir `fiche` garde les lectures historiques (impression, exports)
   valables tant qu'elles ne connaissent qu'une fiche. */
function syncLegacyFiche(intervention) {
  const first = intervention.fiches[0]
  if (!first) return
  const obj = first.toObject ? first.toObject() : { ...first }
  Object.assign(obj, intervention.visite || {})
  intervention.fiche = obj
  intervention.markModified('fiche')
}

async function saveFiche(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    ensureFiches(intervention)

    /* Ce que la saisie déplace réellement, relevé avant écriture : après
       clôture, c'est ce détail qui part dans l'historique. */
    const changes = []

    const touchesFiche = FICHE_FIELDS.some(k => req.body[k] !== undefined)
    if (touchesFiche) {
      const entry = ficheFor(intervention, req.body.dea || null)
      // Sur une visite multi-DAE, un « Niveau batterie » sans appareil ne dit rien.
      const prefix = intervention.fiches.length > 1
        ? `${entry.deaLabel || entry.serialNumber || 'DAE'} — `
        : ''
      FICHE_FIELDS.forEach(k => {
        if (req.body[k] === undefined) return
        const next = req.body[k] === '' ? undefined : req.body[k]
        if (!sameHistValue(entry[k], next)) changes.push(describeChange(k, entry[k], next, prefix))
        entry[k] = next
      })
    }

    if (VISITE_FIELDS.some(k => req.body[k] !== undefined)) {
      if (!intervention.visite) intervention.visite = {}
      VISITE_FIELDS.forEach(k => {
        if (req.body[k] === undefined) return
        const next = req.body[k] === '' ? undefined : req.body[k]
        if (!sameHistValue(intervention.visite[k], next)) {
          changes.push(describeChange(k, intervention.visite[k], next))
        }
        intervention.visite[k] = next
      })
      intervention.markModified('visite')
    }

    intervention.markModified('fiches')
    syncLegacyFiche(intervention)

    logCorrection(intervention, req.user, changes)

    if (intervention.status === 'planifie') {
      intervention.status = 'en_cours'
      intervention.history.push({
        action: 'debut',
        user: req.user._id,
        userName: req.user.fullName || req.user.username,
        details: 'Intervention démarrée',
      })
    }

    await intervention.save()

    /* Une correction après clôture porte sur une visite déjà reportée au
       parc : la fiche client doit suivre la correction, sinon elle reste sur
       la valeur erronée qu'on vient justement de reprendre. */
    if (intervention.status === 'termine' && changes.length) {
      await pushFicheToParc(intervention, req.user)
    }

    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Retirer un appareil de la visite ─────────────────────── */
/* Un DAE ajouté par erreur, ou finalement inaccessible sur place : sa fiche
   quitte la visite plutôt que de rester vide dans le rapport. */
async function removeFiche(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    ensureFiches(intervention)
    const key = req.params.deaId === 'none' ? '' : String(req.params.deaId)
    const idx = intervention.fiches.findIndex(f => String(f.dea || '') === key)
    if (idx === -1) return res.status(404).json({ message: 'Fiche introuvable.' })

    const removed = intervention.fiches[idx]
    // Les photos de cette fiche n'ont plus de rapport à illustrer.
    for (const filename of removed.photos || []) {
      fs.unlink(path.join(__dirname, '..', 'uploads', 'interventions', filename), () => {})
    }
    intervention.fiches.splice(idx, 1)
    intervention.markModified('fiches')
    if (!intervention.fiches.length) intervention.fiche = {}
    else syncLegacyFiche(intervention)

    logCorrection(intervention, req.user, `Fiche retirée après clôture : ${removed.deaLabel || removed.serialNumber || 'DAE'}`)

    await intervention.save()
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Close intervention ────────────────────────────────────── */
async function closeIntervention(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    intervention.status = 'termine'
    intervention.completedDate = new Date()
    intervention.history.push({
      action: 'cloture',
      user: req.user._id,
      userName: req.user.fullName || req.user.username,
      details: 'Intervention clôturée',
    })

    await intervention.save()
    await pushFicheToParc(intervention, req.user)
    await refreshNextControl(intervention)
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Upload photo (fiche) ──────────────────────────────────── */
async function uploadFichePhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' })

    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })
    if (!canWriteFiche(req.user, intervention)) {
      // Le fichier est déjà sur le disque quand le refus tombe : multer écrit
      // avant nous. On le reprend, sinon chaque tentative laisse un orphelin.
      fs.unlink(req.file.path, () => {})
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    // Les photos illustrent un appareil précis : elles suivent sa fiche.
    ensureFiches(intervention)
    const entry = ficheFor(intervention, req.body?.dea || req.query.dea || null)
    if (!entry.photos) entry.photos = []
    entry.photos.push(req.file.filename)
    intervention.markModified('fiches')
    syncLegacyFiche(intervention)
    logCorrection(intervention, req.user, 'Photo ajoutée après clôture')

    await intervention.save()
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Delete photo (fiche) ──────────────────────────────────── */
async function deleteFichePhoto(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    const { filename } = req.params
    ensureFiches(intervention)
    const entry = intervention.fiches.find(f => (f.photos || []).includes(filename))
    if (!entry) return res.status(404).json({ message: 'Photo introuvable.' })

    fs.unlink(path.join(__dirname, '..', 'uploads', 'interventions', filename), () => {})
    entry.photos.splice(entry.photos.indexOf(filename), 1)
    intervention.markModified('fiches')
    syncLegacyFiche(intervention)
    logCorrection(intervention, req.user, 'Photo supprimée après clôture')
    await intervention.save()
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Identifier les consommables montés sur le DAE ─────────── */
/**
 * Batterie et électrodes en place, saisies depuis la fiche d'intervention.
 *
 * Contrôler l'état d'une batterie que le parc ne connaît pas ne mène nulle
 * part : on coche « absence de corrosion » sur un appareil dont personne ne
 * sait quel modèle il porte, et la fiche client reste vide. Le technicien
 * identifie donc la pièce avant de la contrôler, et cette identification va
 * directement au parc — c'est la même donnée, pas une copie.
 *
 * Passe par l'intervention, et non par la fiche client : le technicien n'a pas
 * le droit de gestion des clients, mais il est le mieux placé pour dire ce
 * qu'il a sous les yeux.
 */
const DEA_ITEM_KINDS = { batteries: 'Batterie', electrodes: 'Électrodes' }

async function saveDeaItems(req, res) {
  try {
    const kind = req.params.kind
    if (!DEA_ITEM_KINDS[kind]) return res.status(400).json({ message: 'Type inconnu.' })

    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })
    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    let siteId = intervention.site
    if (!siteId && intervention.installation) {
      const owner = await Site.findOne({ 'deas._id': intervention.installation }).select('_id').lean()
      siteId = owner?._id
    }
    const site = siteId ? await Site.findById(siteId) : null
    if (!site) return res.status(404).json({ message: 'Site introuvable.' })

    const deaId = req.body.dea || intervention.installation
    const dea = deaId ? site.deas.id(deaId) : (site.deas.length === 1 ? site.deas[0] : null)
    if (!dea) return res.status(404).json({ message: 'DAE introuvable.' })

    dea[kind] = Array.isArray(req.body.items) ? req.body.items : []
    await site.save()
    // L'exemplaire du stock suit l'appareil sur lequel il est monté : la pièce
    // déclarée ici est chez le client, elle n'est plus à l'entrepôt.
    await syncDeaWithItem(site, dea)
    await syncDeaConsumables(site, dea, kind)

    const listed = dea[kind]
      .map(it => [it.productName, it.serialNumber || it.lotNumber].filter(Boolean).join(' · '))
      .filter(Boolean)
    intervention.history.push({
      action:   'sync_parc',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  `${DEA_ITEM_KINDS[kind]} du ${dea.deviceType || 'DAE'} : `
                + (listed.length ? listed.join(' · ') : 'aucune pièce déclarée'),
    })
    await intervention.save()

    const json = intervention.toObject()
    const { deviceProduct, siteDeas } = await parcOf(intervention)
    json.deviceProduct = deviceProduct
    json.siteDeas      = siteDeas
    res.json(json)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Delete ────────────────────────────────────────────────── */
async function remove(req, res) {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Accès refusé.' })
    const intervention = await Intervention.findByIdAndDelete(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })
    await refreshNextControl(intervention)
    res.json({ message: 'Supprimée.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Search installations (no canManageDevices needed) ────── */
async function searchInstallations(req, res) {
  try {
    const { search = '', limit = 20 } = req.query
    const q = search.trim()
    // Le parc vit dans les sites : la recherche porte sur les DEA déclarés.
    const rows = await listInstallations(q ? { search: q } : {})
    res.json(rows.slice(0, Number(limit)))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

module.exports = {
  getAll, getOne, create, update, submitRapport, remove, searchInstallations,
  saveFiche, removeFiche, closeIntervention, uploadFichePhoto, deleteFichePhoto,
  saveDeaItems,
}
