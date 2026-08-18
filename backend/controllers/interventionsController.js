const path           = require('path')
const fs             = require('fs')
const Intervention   = require('../models/Intervention')
const Site           = require('../models/Site')
const { listInstallations } = require('../utils/deaParc')
const { syncSiteNextControl } = require('../utils/controls')

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

/* ─── Submit rapport (technicien) ───────────────────────────── */
async function submitRapport(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Technician can only fill their own
    if (req.user.role === 'technicien' &&
        String(intervention.technicien) !== String(req.user._id)) {
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
    // La visite est faite : l'échéance du site passe à la suivante.
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

    if (req.user.role === 'technicien' &&
        String(intervention.technicien) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    ensureFiches(intervention)

    const touchesFiche = FICHE_FIELDS.some(k => req.body[k] !== undefined)
    if (touchesFiche) {
      const entry = ficheFor(intervention, req.body.dea || null)
      FICHE_FIELDS.forEach(k => {
        if (req.body[k] !== undefined) {
          entry[k] = req.body[k] === '' ? undefined : req.body[k]
        }
      })
    }

    if (VISITE_FIELDS.some(k => req.body[k] !== undefined)) {
      if (!intervention.visite) intervention.visite = {}
      VISITE_FIELDS.forEach(k => {
        if (req.body[k] !== undefined) {
          intervention.visite[k] = req.body[k] === '' ? undefined : req.body[k]
        }
      })
      intervention.markModified('visite')
    }

    intervention.markModified('fiches')
    syncLegacyFiche(intervention)

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

    if (req.user.role === 'technicien' &&
        String(intervention.technicien) !== String(req.user._id)) {
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

    if (req.user.role === 'technicien' &&
        String(intervention.technicien) !== String(req.user._id)) {
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

    // Les photos illustrent un appareil précis : elles suivent sa fiche.
    ensureFiches(intervention)
    const entry = ficheFor(intervention, req.body?.dea || req.query.dea || null)
    if (!entry.photos) entry.photos = []
    entry.photos.push(req.file.filename)
    intervention.markModified('fiches')
    syncLegacyFiche(intervention)

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

    const { filename } = req.params
    ensureFiches(intervention)
    const entry = intervention.fiches.find(f => (f.photos || []).includes(filename))
    if (!entry) return res.status(404).json({ message: 'Photo introuvable.' })

    fs.unlink(path.join(__dirname, '..', 'uploads', 'interventions', filename), () => {})
    entry.photos.splice(entry.photos.indexOf(filename), 1)
    intervention.markModified('fiches')
    syncLegacyFiche(intervention)
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
  getAll, getOne, create, update, submitRapport, remove, searchInstallations,
  saveFiche, removeFiche, closeIntervention, uploadFichePhoto, deleteFichePhoto,
}
