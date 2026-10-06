const mongoose       = require('mongoose')
const path           = require('path')
const fs             = require('fs')
const Intervention   = require('../models/Intervention')
const Site           = require('../models/Site')
const Formation      = require('../models/Formation')
const Replacement    = require('../models/Replacement')
const { listInstallations } = require('../utils/deaParc')
const { syncSiteNextControl } = require('../utils/controls')
const { syncFicheToParc } = require('../utils/ficheSync')
const { syncDeaWithItem, syncDeaConsumables } = require('../utils/productItems')
const { archiveRapport } = require('../utils/rapportArchive')
const { applyBon } = require('../utils/bon')

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
 * Une visite non démarrée se consulte, elle ne se saisit pas.
 *
 * Ouvrir la fiche pour préparer sa tournée ne doit pas laisser de trace de
 * relevé : c'est le clic sur « Démarrer l'intervention » qui marque l'arrivée
 * sur site, et lui seul qui ouvre la checklist. Sans ce verrou, la première
 * case cochée par mégarde faisait basculer la visite en cours.
 *
 * La correction après clôture reste possible : elle a son propre chemin.
 */
function ensureStarted(intervention, res) {
  if (intervention.status !== 'planifie') return true
  res.status(409).json({
    message: "L'intervention n'a pas été démarrée. Cliquez sur « Démarrer l'intervention » avant de saisir la checklist.",
    code: 'NOT_STARTED',
  })
  return false
}

/* ─── Démarrer l'intervention ──────────────────────────────── */
async function startIntervention(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }
    // Rejouer le démarrage ne doit ni réécrire l'heure d'arrivée ni rouvrir
    // une visite clôturée : on répond simplement l'état courant.
    if (intervention.status !== 'planifie') {
      return res.json(await withParc(intervention))
    }

    intervention.status    = 'en_cours'
    intervention.startedAt = new Date()
    intervention.history.push({
      action:   'debut',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  'Intervention démarrée',
    })

    await intervention.save()
    res.json(await withParc(intervention))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* La réponse porte le parc : l'écran se met à jour sans rechargement. */
async function withParc(intervention) {
  const json = intervention.toObject({ flattenMaps: true })
  const { deviceProduct, siteDeas } = await parcOf(intervention)
  json.deviceProduct = deviceProduct
  json.siteDeas      = siteDeas
  return json
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
  armoireModele: "Type d'armoire", armoirePilesRemplacees: 'Piles armoire remplacées',
  armoirePilesNote: 'Note piles armoire',

  dernierControle: 'Dernier contrôle', prochainControle: 'Prochain contrôle',
  observation: 'Observation',

  dateReception: 'Date de réception', visa: 'Visa',
  observationGenerale: 'Remarque',
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
    // La pose est déjà connue du parc : la checklist l'affiche sans la demander.
    installationDate: d.installationDate,
    product:      d.product ? { _id: d.product._id, name: d.product.name, images: d.product.images } : null,
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
    // L'armoire et l'état connu de ses piles : la checklist part de là.
    armoire: d.armoire ? {
      model: d.armoire.model, pilesStatus: d.armoire.pilesStatus,
      pilesCheckedAt: d.armoire.pilesCheckedAt, pilesReplacedAt: d.armoire.pilesReplacedAt,
    } : null,
  }))

  // L'appareil visé, s'il y en a un ; à défaut le seul du site, qui ne laisse
  // place à aucune ambiguïté.
  const target = intervention.installation
    ? site.deas.id(intervention.installation)
    : (site.deas?.length === 1 ? site.deas[0] : null)

  return { deviceProduct: target?.product || null, siteDeas }
}

/**
 * Séances de formation rattachées à la visite.
 *
 * Une visite d'entretien est souvent l'occasion de former les agents du site :
 * le technicien est le seul à savoir si la séance a eu lieu ce jour-là, ou si
 * elle a été repoussée. On lui présente donc les séances du site — à défaut
 * celles du client, les formations d'avant les sites n'en ayant pas — pour
 * qu'il tranche sans quitter sa fiche.
 */
async function formationsOf(intervention) {
  const query = intervention.site
    ? { $or: [{ site: intervention.site._id || intervention.site }, { client: intervention.client, site: null }] }
    : (intervention.client ? { client: intervention.client } : null)
  if (!query) return []

  return Formation.find(query)
    .select('title date end status attestationDelivered participants participantsCount siteName clientName')
    .sort({ date: -1 })
    .limit(20)
    .lean()
}

/**
 * Passages hors calendrier depuis le contrôle technique précédent.
 *
 * Le rapport d'un contrôle semestriel ou annuel doit retracer tout ce qui
 * s'est fait sur le site entre deux contrôles — intervention ponctuelle,
 * contrôle hors contrat, pose d'un DAE, remplacement, formation — pour que
 * l'historique du parc se lise d'un seul document.
 *
 * Sans contrôle précédent, la période remonte à douze mois.
 */
const HORS_DELAI_TYPES = ['semestriel', 'annuel']
async function horsDelaiOf(intervention) {
  if (!HORS_DELAI_TYPES.includes(intervention.controlType) || !intervention.site) return null
  const siteId = intervention.site._id || intervention.site
  const until  = intervention.completedDate || new Date()

  const previous = await Intervention.findOne({
    _id: { $ne: intervention._id }, site: siteId, status: 'termine',
    controlType: { $in: HORS_DELAI_TYPES }, completedDate: { $lt: until },
  }).sort({ completedDate: -1 }).select('completedDate controlType').lean()

  const since = previous?.completedDate
    || new Date(new Date(until).setFullYear(new Date(until).getFullYear() - 1))
  const inRange = { $gt: since, $lte: until }
  const items = []

  const [visits, site, replacements, formations] = await Promise.all([
    Intervention.find({
      _id: { $ne: intervention._id }, site: siteId, status: 'termine',
      controlType: { $in: ['intervention', 'hors_contrat'] }, completedDate: inRange,
    }).select('controlType objet completedDate technicienName installationSnap').lean(),
    Site.findById(siteId).select('deas').lean(),
    Replacement.find({
      site: siteId, status: 'remplace', intervention: { $ne: intervention._id },
      $or: [{ replacedAt: inRange }, { replacedAt: null, updatedAt: inRange }],
    }).select('kind reason deaLabel serialNumber lotNumber replacementSerial replacedAt updatedAt requestedByName').lean(),
    Formation.find({ site: siteId, status: 'fait', date: inRange })
      .select('title date participants participantsCount').lean(),
  ])

  for (const v of visits) {
    items.push({
      date:   v.completedDate,
      nature: v.controlType === 'hors_contrat' ? 'Contrôle hors contrat' : 'Intervention',
      detail: v.objet || [v.installationSnap?.deviceType, v.installationSnap?.serialNumber].filter(Boolean).join(' · '),
      by:     v.technicienName,
    })
  }
  for (const d of site?.deas || []) {
    const at = d.installationDate
    if (d.status === 'a_installer' || !at || at <= since || at > until) continue
    items.push({
      date: at, nature: 'Installation',
      detail: [d.deviceType || 'DAE', d.serialNumber && `n° ${d.serialNumber}`, d.location].filter(Boolean).join(' · '),
      by: d.technicianName,
    })
  }
  for (const r of replacements) {
    const piece = Replacement.KIND_LABELS[r.kind] || r.kind
    const reason = Replacement.REASON_LABELS[r.reason]
    items.push({
      date:   r.replacedAt || r.updatedAt,
      nature: `Remplacement — ${piece}`,
      detail: [r.deaLabel, reason && reason.toLowerCase(),
        r.replacementSerial && `nouvelle pièce ${r.replacementSerial}`].filter(Boolean).join(' · '),
      by: r.requestedByName,
    })
  }
  for (const f of formations) {
    const n = f.participants?.length
      ? f.participants.filter(p => p.status === 'forme').length
      : f.participantsCount
    items.push({
      date: f.date, nature: 'Formation',
      detail: [f.title, n ? `${n} personne${n > 1 ? 's' : ''} formée${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
    })
  }

  items.sort((a, b) => new Date(a.date) - new Date(b.date))
  return { since, until, previous: previous ? { date: previous.completedDate, controlType: previous.controlType } : null, items }
}

/**
 * Prochain contrôle du site après cette visite — celui que le planning porte
 * réellement (la date relevée sur la checklist l'y a déjà déplacé à la
 * clôture). Les interventions ponctuelles n'en sont pas.
 */
async function nextControlOf(intervention) {
  if (!intervention.site) return null
  const after = intervention.completedDate || intervention.scheduledDate || new Date()
  const next = await Intervention.findOne({
    _id: { $ne: intervention._id },
    site: intervention.site._id || intervention.site,
    status: { $ne: 'termine' },
    controlType: { $ne: 'intervention' },
    scheduledDate: { $gt: after },
  }).sort({ scheduledDate: 1 }).select('scheduledDate controlType').lean()
  return next ? { date: next.scheduledDate, controlType: next.controlType } : null
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
    const json = intervention.toObject({ flattenMaps: true })
    const { deviceProduct, siteDeas } = await parcOf(intervention)
    json.deviceProduct = deviceProduct
    json.siteDeas      = siteDeas
    json.formations    = await formationsOf(intervention)
    json.horsDelai     = await horsDelaiOf(intervention)
    json.nextControl   = await nextControlOf(intervention)

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
      scheduledDate, notes, objet,
      controlType, contract,
    } = req.body

    const CONTROL_TYPES = ['semestriel', 'annuel', 'hors_contrat', 'intervention']

    /* Un identifiant d'appareil malformé remontait tel quel dans l'erreur de
       cast Mongoose (« Cast to ObjectId failed for value "Powerheart G5 · …" »),
       illisible pour qui programme une visite. On tranche ici, en français. */
    for (const [champ, valeur] of [['client', client], ['site', site], ['installation', installation]]) {
      if (valeur && !mongoose.Types.ObjectId.isValid(valeur)) {
        return res.status(400).json({
          message: `Sélection invalide pour « ${champ} ». Rechargez la page et refaites votre choix.`,
        })
      }
    }

    const intervention = await Intervention.create({
      client, clientName,
      // Le site porte le contexte du contrôle (adresse, parc) : sans lui, la
      // fiche ne sait plus où la visite a lieu.
      site: site || undefined, siteName,
      installation, installationSnap,
      technicien, technicienName,
      scheduledDate, notes, objet,
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
                     'technicien','technicienName','scheduledDate','notes','objet','status','controlType','contract']
    allowed.forEach(k => { if (req.body[k] !== undefined) intervention[k] = req.body[k] })

    /* Une date choisie (planning, glisser-déposer) n'est plus l'échéance
       théorique du contrat : sans ce drapeau, la resynchronisation du contrat
       verrait une visite « hors calendrier » et la supprimerait. */
    if (req.body.scheduledDate !== undefined && intervention.isModified('scheduledDate')) {
      intervention.manualDate = true
    }

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
    if (!ensureStarted(intervention, res)) return

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
  'voyantVert', 'autotests', 'armoire', 'armoireAccessible',
  // Armoire et piles de son alarme
  'armoireModele', 'armoirePiles', 'armoirePilesRemplacees', 'armoirePilesNote',
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

/**
 * Complète une fiche avec ce que le parc connaît déjà de l'appareil : n° de
 * série, emplacement, péremptions des consommables en place, modèle d'armoire.
 *
 * L'écran les affiche pré-remplis ; sans cette copie, une valeur jamais
 * retouchée manquait au rapport. Seuls les champs vides sont complétés, et
 * jamais celui que la requête est justement en train d'écrire — un champ
 * vidé exprès doit rester vide.
 */
async function seedFicheFromParc(entry, body) {
  if (!entry?.dea) return
  const site = await Site.findOne({ 'deas._id': entry.dea }).select('deas').lean()
  const dea  = site?.deas?.find(d => String(d._id) === String(entry.dea))
  if (!dea) return

  const adulte = dea.electrodes?.find(e => e.kind === 'adulte' || !e.kind)
  const enfant = dea.electrodes?.find(e => e.kind === 'enfant')
  const fromParc = {
    serialNumber:                    dea.serialNumber,
    emplacement:                     dea.location,
    batteriePeremption:              dea.batteries?.[0]?.expiryDate,
    electrodesPeremptionAdulte:      adulte?.expiryDate,
    electrodesPeremptionPediatrique: enfant?.expiryDate,
    armoireModele:                   dea.armoire?.model,
  }
  Object.entries(fromParc).forEach(([k, v]) => {
    if (body[k] !== undefined) return
    if (v === undefined || v === null || v === '') return
    if (entry[k] !== undefined && entry[k] !== null && entry[k] !== '') return
    entry[k] = v
  })
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
    if (!ensureStarted(intervention, res)) return

    ensureFiches(intervention)

    /* Ce que la saisie déplace réellement, relevé avant écriture : après
       clôture, c'est ce détail qui part dans l'historique. */
    const changes = []

    const touchesFiche = FICHE_FIELDS.some(k => req.body[k] !== undefined)
    if (touchesFiche) {
      const entry = ficheFor(intervention, req.body.dea || null)
      await seedFicheFromParc(entry, req.body)
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

    await intervention.save()

    /* Une correction après clôture porte sur une visite déjà reportée au
       parc : la fiche client doit suivre la correction, sinon elle reste sur
       la valeur erronée qu'on vient justement de reprendre. */
    if (intervention.status === 'termine' && changes.length) {
      await pushFicheToParc(intervention, req.user)
    } else if (changes.length) {
      /* Visite en cours : ce qui est relevé descend aussitôt sur la fiche du
         DAE et sur l'article monté. Attendre la clôture laissait trois écrans
         se contredire pendant toute la visite — la péremption corrigée ici,
         l'ancienne encore affichée côté client et côté stock.
         Le planning, lui, attend la clôture : déplacer une visite à chaque
         frappe n'aurait aucun sens. L'historique n'est pas alourdi non plus,
         la ligne de correction dit déjà ce qui a changé. */
      await syncFicheToParc(intervention, req.user, { planning: false })
    }

    /* La réponse porte le parc rafraîchi : l'écran affiche la pièce telle
       qu'elle vient d'être mise à jour, sans attendre un rechargement. */
    const json = intervention.toObject({ flattenMaps: true })
    const { deviceProduct, siteDeas } = await parcOf(intervention)
    json.deviceProduct = deviceProduct
    json.siteDeas      = siteDeas
    res.json(json)
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
    if (!ensureStarted(intervention, res)) return

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

    /* Deuxième passage : la visite avait été rouverte pour correction. Le dire
       dans l'historique évite de lire deux clôtures identiques sans comprendre
       ce qui s'est passé entre les deux. */
    const reCloture = Boolean(intervention.completedDate)

    intervention.status = 'termine'
    intervention.completedDate = new Date()
    intervention.history.push({
      action: 'cloture',
      user: req.user._id,
      userName: req.user.fullName || req.user.username,
      details: reCloture
        ? 'Intervention clôturée de nouveau après modification'
        : 'Intervention clôturée',
    })

    await intervention.save()
    await pushFicheToParc(intervention, req.user)
    await refreshNextControl(intervention)
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Rouvrir une intervention clôturée ─────────────────────── */
/**
 * Une clôture n'est pas une fin de non-recevoir.
 *
 * Le technicien clôture depuis le site, souvent au moment de repartir, et
 * s'aperçoit ensuite d'un oubli — une photo, une péremption, un kit non coché.
 * Sans réouverture, la seule issue était d'appeler l'administration pour
 * qu'elle corrige à sa place, alors qu'il a l'appareil sous les yeux.
 *
 * La réouverture remet la visite « en cours » : la checklist redevient
 * saisissable par son chemin normal, sans mode de correction parallèle. Elle
 * laisse sa trace dans l'historique, et la clôture suivante dit qu'elle en est
 * une seconde — la chronologie reste lisible.
 */
async function reopenIntervention(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    /* Rouvrent : le technicien qui a fait la visite, et l'administration.
       `canWriteFiche` ne convient pas ici — il ferme justement la porte au
       technicien une fois la visite clôturée. */
    const owner = String(intervention.technicien || '') === String(req.user._id)
    if (!isAdmin(req.user) && req.user.role !== 'superadmin' && !owner) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    if (intervention.status !== 'termine') {
      // Rejouer la réouverture ne doit pas empiler des lignes d'historique.
      return res.json(await withParc(intervention))
    }

    const motif = String(req.body?.motif || '').trim()

    intervention.status = 'en_cours'
    intervention.history.push({
      action:   'reouverture',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  motif
        ? `Intervention rouverte pour modification — ${motif}`
        : 'Intervention rouverte pour modification',
    })

    await intervention.save()
    /* La visite n'est plus faite : l'échéance du site se recalcule, sinon le
       planning garderait le prochain contrôle issu d'une clôture annulée. */
    await refreshNextControl(intervention)
    res.json(await withParc(intervention))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Rapport PDF dans les documents du client ──────────────── */
/**
 * Le PDF est produit par le navigateur, à partir de la même page que
 * « Imprimer / Télécharger » : le client reçoit dans ses documents exactement
 * le rapport qu'on lui aurait remis. Le serveur ne fait que le ranger.
 */
async function saveRapportPdf(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucun PDF reçu.' })

    const intervention = await Intervention.findById(req.params.id).populate('site', 'name')
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Même cercle que la réouverture : le technicien de la visite et l'administration.
    const owner = String(intervention.technicien || '') === String(req.user._id)
    if (!isAdmin(req.user) && req.user.role !== 'superadmin' && !owner) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }
    if (intervention.status !== 'termine') {
      return res.status(409).json({ message: "Le rapport s'archive une fois l'intervention clôturée." })
    }

    const doc = await archiveRapport(intervention, req.file.buffer, req.user._id)
    if (String(intervention.rapportDocument || '') !== String(doc._id)) {
      // `updateOne` : archiver ne doit pas toucher à la date de modification de la visite.
      await Intervention.updateOne({ _id: intervention._id }, { rapportDocument: doc._id }, { timestamps: false })
    }
    res.json({ document: doc })
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
    if (intervention.status === 'planifie') {
      // Même raison qu'au-dessus : le fichier est déjà écrit, il faut le reprendre
      // avant de refuser.
      fs.unlink(req.file.path, () => {})
      return ensureStarted(intervention, res)
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
    if (!ensureStarted(intervention, res)) return

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
    if (!ensureStarted(intervention, res)) return

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

    const json = intervention.toObject({ flattenMaps: true })
    const { deviceProduct, siteDeas } = await parcOf(intervention)
    json.deviceProduct = deviceProduct
    json.siteDeas      = siteDeas
    res.json(json)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Sort de la formation, tranché depuis la visite ────────── */
/**
 * « Effectuée » ou « reportée » : le technicien tranche, la séance suit.
 *
 * La formation vivait dans son propre écran, alimenté par l'assistante. Mais
 * c'est sur place qu'on apprend qu'une séance n'a pas pu se tenir — agents
 * indisponibles, site en travaux — et personne ne revenait le dire. La fiche
 * de visite porte donc la décision, et la répercute sur la séance elle-même :
 * une formation confirmée passe en « Terminé » et attend ses attestations ;
 * une formation reportée change de date sans quitter le planning.
 *
 * La trace reste des deux côtés : sur la séance, pour l'assistante ; sur la
 * visite, pour le rapport, qui doit rester lisible même si la séance est
 * modifiée ou supprimée plus tard.
 */
/* Deux issues et le retrait de la mention : la checklist ne propose rien de
   plus, et le rapport n'a rien d'autre à dire. */
const FORMATION_ETATS = ['', 'effectuee', 'reportee']

async function saveFormation(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })
    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }
    if (!ensureStarted(intervention, res)) return

    const { etat = '', date, note } = req.body
    if (!FORMATION_ETATS.includes(etat)) {
      return res.status(400).json({ message: 'État de formation inconnu.' })
    }

    let formation = req.body.formation
      ? await Formation.findById(req.body.formation)
      : null
    if (req.body.formation && !formation) {
      return res.status(404).json({ message: 'Formation introuvable.' })
    }

    /* La séance sur laquelle cette visite s'est déjà prononcée, d'abord :
       sans elle, corriger « Effectuée » en « Reportée » ne rouvrirait rien —
       la séance étant passée en « Terminé », elle ne fait plus partie des
       séances ouvertes qu'on va chercher ensuite. */
    if (!formation && intervention.formation?.formation) {
      formation = await Formation.findById(intervention.formation.formation)
    }

    /* Personne ne désigne la séance : la checklist ne demande que l'issue. On
       prend la séance encore ouverte du site — la plus proche de la visite,
       c'est celle dont on parle. Sans séance ouverte, la décision reste sur la
       visite seule : elle n'a rien à déplacer. */
    if (!formation && intervention.site && etat) {
      const ouvertes = await Formation.find({
        site:   intervention.site,
        status: { $in: ['planifie', 'en_cours'] },
      }).sort({ date: 1 })

      if (ouvertes.length) {
        const repere = new Date(intervention.completedDate || intervention.scheduledDate || Date.now()).getTime()
        formation = ouvertes.reduce((best, f) => (
          Math.abs(new Date(f.date).getTime() - repere) < Math.abs(new Date(best.date).getTime() - repere)
            ? f : best
        ))
      }
    }

    const who = req.user.fullName || req.user.username
    const visitDate = intervention.completedDate || intervention.scheduledDate || new Date()

    if (formation) {
      if (etat === 'effectuee') {
        // La séance a eu lieu : les attestations restent à préparer.
        formation.status = 'fait'
        formation.date   = date || formation.date || visitDate
        formation.history.push({
          action: 'Formation confirmée effectuée',
          by: req.user._id,
          details: `Confirmée lors de la visite du ${new Date(visitDate).toLocaleDateString('fr-FR')}`,
        })
      } else if (etat === 'reportee') {
        /* Reportée sans date : la séance reste à programmer et repasse en
           « Programmé ». C'est à l'assistante de lui trouver un nouveau
           créneau — le technicien constate, il ne prend pas le rendez-vous. */
        formation.status = 'planifie'
        formation.history.push({
          action: 'Formation reportée',
          by: req.user._id,
          details: `Séance non tenue lors de la visite du `
                 + `${new Date(visitDate).toLocaleDateString('fr-FR')} — à reprogrammer`,
        })
      }
      if (etat === 'effectuee' || etat === 'reportee') await formation.save()
    }

    intervention.formation = {
      etat,
      // Seule la réalisation porte une date : celle de la visite.
      date:      etat === 'effectuee' ? (date || visitDate) : undefined,
      formation: formation?._id,
      titre:     formation?.title || '',
      note:      note || '',
    }
    intervention.markModified('formation')

    const LABELS = {
      effectuee: 'Formation effectuée',
      reportee:  'Formation reportée',
      '':        'Mention de formation retirée',
    }
    intervention.history.push({
      action:   'formation',
      user:     req.user._id,
      userName: who,
      details:  LABELS[etat] + (formation ? ` — ${formation.title}` : ''),
    })

    await intervention.save()

    const json = intervention.toObject({ flattenMaps: true })
    json.formations = await formationsOf(intervention)
    res.json(json)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Bon d'intervention ────────────────────────────────────── */
/**
 * Nature de l'intervention et signature du client.
 *
 * Le bon est le seul document que le client garde : il atteste du passage, de
 * sa nature et de son constat. Ces deux champs vivent sur la visite plutôt que
 * dans le PDF, pour qu'un bon réimprimé six mois plus tard dise la même chose
 * que le premier.
 */
async function saveBon(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })
    if (!canWriteFiche(req.user, intervention)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }
    if (!ensureStarted(intervention, res)) return

    try {
      applyBon(intervention, req.body)
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ message: err.message })
      throw err
    }
    await intervention.save()

    res.json(intervention)
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
  startIntervention,
  getAll, getOne, create, update, submitRapport, remove, searchInstallations,
  saveFiche, removeFiche, closeIntervention, reopenIntervention,
  uploadFichePhoto, deleteFichePhoto,
  saveDeaItems, saveFormation, saveBon,
  saveRapportPdf,
}
