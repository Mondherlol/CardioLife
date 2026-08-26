const mongoose = require('mongoose')
const { validationResult } = require('express-validator')
const Site         = require('../models/Site')
const Client       = require('../models/Client')
const ProductItem  = require('../models/ProductItem')
const Document     = require('../models/Document')
const Formation    = require('../models/Formation')
const Intervention = require('../models/Intervention')
const Control      = require('../models/Control')
const Appointment  = require('../models/Appointment')
const Contract     = require('../models/Contract')
const Replacement  = require('../models/Replacement')
const { syncDeaWithItem, syncDeaConsumables, syncProductStock, logHistory } = require('../utils/productItems')
const { getOrCreateSiteFolder } = require('../utils/siteDocsFolder')
const { trainingQuota } = require('../utils/training')
const { syncSiteControls } = require('../utils/controls')

/**
 * La dépose d'un DEA remet en stock tout ce qui était monté dessus.
 *
 * L'appareil, mais aussi ses consommables : depuis que la batterie déclarée
 * sort du stock, la laisser rattachée à un DAE qui n'existe plus la rendrait
 * introuvable — ni en stock, ni chez un client.
 */
async function releaseItemForDea(deaId) {
  const items = await ProductItem.find({ dea: deaId })
  for (const item of items) {
    const from = item.status
    item.dea = undefined; item.site = undefined; item.client = undefined
    item.reservedFor = undefined
    item.status = 'disponible'
    await logHistory(item, { action: 'Retour en stock (DEA retiré du parc)', from, to: 'disponible' })
    await syncProductStock(item.product)
  }
}

function checkValidation(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() })
    return false
  }
  return true
}

async function findSite(req, res) {
  const site = await Site.findById(req.params.id)
  if (!site) {
    res.status(404).json({ message: 'Site introuvable.' })
    return null
  }
  return site
}

/* GET /api/sites?client=<id> */
async function getAll(req, res) {
  const { client, archived = 'false' } = req.query
  const filter = { isActive: archived === 'true' ? false : true }
  if (client) filter.client = client

  const sites = await Site.find(filter)
    .sort({ name: 1 })
    .collation({ locale: 'fr', strength: 1 })
  res.json(sites)
}

/* GET /api/sites/lookup?client=<id>
   Sites d'un client réduits à ce qu'il faut pour les désigner : nom, adresse et
   parc. Ouvert à tout utilisateur connecté — programmer une visite ne suppose
   pas de pouvoir modifier la fiche client. */
async function lookup(req, res) {
  const { client } = req.query
  if (!client) return res.json([])

  const sites = await Site.find({ client, isActive: true })
    .select('name address deas.deviceType deas.serialNumber deas.location deas.status')
    .sort({ name: 1 })
    .collation({ locale: 'fr', strength: 1 })
    .lean()
  res.json(sites)
}

/* GET /api/sites/deas
   Parc réel à plat : un objet par DEA posé, tous clients confondus. C'est la
   source de la page « DAE installés ». */
async function listDeas(req, res) {
  const { client } = req.query
  const match = { isActive: true }
  if (client) match.client = new mongoose.Types.ObjectId(client)

  const deas = await Site.aggregate([
    { $match: match },
    { $unwind: '$deas' },
    {
      $lookup: {
        from: 'clients',
        localField: 'client',
        foreignField: '_id',
        as: 'clientDoc',
      },
    },
    { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id:  '$deas._id',
        site: { _id: '$_id', name: '$name', address: '$address', contacts: '$contacts' },
        client: {
          _id:           '$clientDoc._id',
          name:          '$clientDoc.name',
          logo:          '$clientDoc.logo',
          underContract: '$clientDoc.underContract',
        },
        deviceType:       '$deas.deviceType',
        serialNumber:     '$deas.serialNumber',
        location:         '$deas.location',
        status:           '$deas.status',
        scheduledDate:    '$deas.scheduledDate',
        technicianName:   '$deas.technicianName',
        installationDate: '$deas.installationDate',
        nextControlDate:  '$deas.nextControlDate',
        batteries:        '$deas.batteries',
        electrodes:       '$deas.electrodes',
        notes:            '$deas.notes',
      },
    },
    { $sort: { 'client.name': 1, 'site.name': 1 } },
  ]).collation({ locale: 'fr', strength: 1 })

  res.json(deas)
}

async function getById(req, res) {
  const site = await Site.findById(req.params.id)
    .populate('client', 'name logo underContract address')
  if (!site) return res.status(404).json({ message: 'Site introuvable.' })
  res.json(site)
}

/* ── Historique complet d'un site ──────────────────────────────
   Une seule requête alimente la fiche du site : parc, formations,
   contrôles, interventions, consommables remplacés et rendez-vous. */

/* Champs de rapport dont la valeur « remplacé » vaut un remplacement de pièce. */
const REPLACEMENT_FIELDS = [
  { key: 'batterie',     label: 'Batterie',      done: 'remplacee'  },
  { key: 'electrodes',   label: 'Électrodes',    done: 'remplacees' },
  { key: 'dae',          label: 'DAE',           done: 'remplace'   },
  { key: 'boitier',      label: 'Boîtier',       done: 'remplace'   },
  { key: 'armoire',      label: 'Armoire',       done: 'remplace'   },
  { key: 'signaletique', label: 'Signalétique',  done: 'remplace'   },
]

/** Extrait les pièces remplacées consignées dans le rapport d'une visite. */
function replacementsFromReport(visit, source, deaLabels) {
  const rapport = visit.rapport || {}
  const date    = visit.completedDate || rapport.dateVisite || visit.scheduledDate
  const deaId   = String(visit.installation || '')

  return REPLACEMENT_FIELDS
    .filter(f => rapport[f.key] === f.done)
    .map(f => ({
      kind:       f.key,
      label:      f.label,
      date,
      source,                       // 'intervention' | 'controle'
      sourceId:   visit._id,
      dea:        deaId || null,
      deaLabel:   deaLabels[deaId] || '',
      technicien: visit.technicienName || visit.technicien?.fullName || '',
      note:       rapport.observations || '',
    }))
}

async function getHistory(req, res) {
  const site = await Site.findById(req.params.id)
    .populate('client', 'name logo underContract address')
  if (!site) return res.status(404).json({ message: 'Site introuvable.' })

  const deaIds = site.deas.map(d => d._id)
  // Étiquette lisible d'un DAE, pour rattacher chaque événement à l'appareil.
  const deaLabels = Object.fromEntries(site.deas.map(d => [
    String(d._id),
    [d.deviceType, d.serialNumber && `n° ${d.serialNumber}`, d.location]
      .filter(Boolean).join(' · ') || 'DAE',
  ]))

  const [formations, interventions, controls, items, appointments, contract] = await Promise.all([
    // Les formations d'avant cette version n'ont pas de `site` : elles restent
    // sur la fiche client tant qu'un site ne leur est pas affecté depuis la
    // modale de formation.
    Formation.find({ site: site._id })
      .populate('assignedTo', 'fullName username')
      .populate('createdBy', 'fullName')
      .populate('attestationDeliveredBy', 'fullName')
      .sort({ date: -1 })
      .lean(),
    // Les visites du contrat portent sur le site entier, celles planifiées
    // depuis un appareil sur un DAE précis : les deux concernent ce site.
    Intervention.find({ $or: [{ site: site._id }, { installation: { $in: deaIds } }] })
      .populate('technicien', 'fullName username')
      .sort({ scheduledDate: -1 })
      .lean(),
    Control.find({ installation: { $in: deaIds } })
      .populate('technicien', 'fullName')
      .sort({ scheduledDate: -1 })
      .lean(),
    ProductItem.find({ site: site._id })
      .populate('product', 'name reference images')
      .sort({ updatedAt: -1 })
      .lean(),
    Appointment.find({ installation: { $in: deaIds } })
      .populate('assignedTo', 'fullName username')
      .sort({ start: -1 })
      .lean(),
    // Contrat en cours du site — le calendrier des visites en découle.
    Contract.findOne({ site: site._id, isActive: true, status: 'actif' })
      .select('contractNumber status startDate endDate')
      .lean(),
  ])

  /* Remplacements du site : les demandes explicites du terrain d'abord, puis
     ce que les anciens rapports de visite consignaient (« remplacé »). Les deux
     décrivent le même fait, ils se lisent dans une seule liste. */
  const requests = await Replacement.find({ site: site._id })
    .populate('requestedBy', 'fullName username')
    .populate('product', 'name reference')
    .sort({ createdAt: -1 })
    .lean()

  const replacements = [
    ...requests.map(r => ({
      _id:        r._id,
      kind:       r.kind,
      label:      Replacement.KIND_LABELS[r.kind] || r.kind,
      status:     r.status,
      reason:     r.reason,
      date:       r.replacedAt || r.createdAt,
      source:     'demande',
      sourceId:   r.intervention || null,
      dea:        r.dea ? String(r.dea) : null,
      deaLabel:   r.deaLabel || deaLabels[String(r.dea)] || '',
      serialNumber:      r.serialNumber || r.lotNumber || '',
      replacementSerial: r.replacementSerial || '',
      productName: r.product?.name || r.productName || '',
      technicien: r.requestedByName || r.requestedBy?.fullName || '',
      note:       r.notes || '',
    })),
    ...interventions.flatMap(iv => replacementsFromReport(iv, 'intervention', deaLabels)),
    ...controls.flatMap(c => replacementsFromReport(c, 'controle', deaLabels)),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))

  res.json({
    site,
    deaLabels,
    contract: contract || null,
    formations,
    interventions,
    controls,
    appointments,
    items,
    replacements,
    training: trainingQuota(site.deas.length, formations),
  })
}

/* GET /api/sites/:id/documents-folder */
async function getDocumentsFolder(req, res) {
  const site = await Site.findById(req.params.id).populate('client', 'name documentsFolder')
  if (!site) return res.status(404).json({ message: 'Site introuvable.' })
  const folder = await getOrCreateSiteFolder(site, req.user._id)
  res.json({ folderId: folder._id, name: folder.name })
}

async function create(req, res) {
  if (!checkValidation(req, res)) return

  const client = await Client.findById(req.body.client)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })

  const site = await Site.create({ ...req.body, createdBy: req.user._id })
  res.status(201).json(site)
}

async function update(req, res) {
  if (!checkValidation(req, res)) return

  // Le client d'un site ne se change pas via cette route, et les DEA ont leurs
  // propres sous-routes pour éviter d'écraser la liste par erreur.
  const { client, deas, createdBy, documentsFolder, ...payload } = req.body

  const before = await Site.findById(req.params.id).select('name documentsFolder')
  if (!before) return res.status(404).json({ message: 'Site introuvable.' })

  const site = await Site.findByIdAndUpdate(
    req.params.id,
    { $set: payload },
    { new: true, runValidators: true }
  )

  // Le nom du site est dénormalisé ailleurs : dossier documentaire, contrats et
  // contrôles le recopient pour s'afficher sans jointure.
  if (payload.name && payload.name !== before.name) {
    if (site.documentsFolder) {
      await Document.findByIdAndUpdate(site.documentsFolder, { name: site.name })
    }
    await Promise.all([
      Contract.updateMany({ site: site._id }, { siteName: site.name }),
      Intervention.updateMany({ site: site._id }, { siteName: site.name }),
    ])
  }

  res.json(site)
}

async function remove(req, res) {
  const site = await findSite(req, res)
  if (!site) return
  await site.deleteOne()
  res.json({ message: 'Site supprimé.' })
}

/* ── DEA ───────────────────────────────────────────── */

/* Le calendrier des visites part de la première pose du site : toute
   modification du parc peut le décaler. */
async function refreshSchedule(site, userId) {
  await syncSiteControls(site._id, userId)
  return Site.findById(site._id)
}

async function addDea(req, res) {
  const site = await findSite(req, res)
  if (!site) return
  site.deas.push(req.body)
  await site.save()
  await syncDeaWithItem(site, site.deas[site.deas.length - 1])
  res.status(201).json(await refreshSchedule(site, req.user._id))
}

async function updateDea(req, res) {
  const site = await findSite(req, res)
  if (!site) return
  const dea = site.deas.id(req.params.deaId)
  if (!dea) return res.status(404).json({ message: 'DEA introuvable.' })
  dea.set(req.body)
  await site.save()
  await syncDeaWithItem(site, dea)
  // Batterie ou électrodes déclarées depuis la fiche client : même pont vers le
  // stock que depuis la checklist du technicien.
  for (const kind of ['batteries', 'electrodes']) {
    if (req.body[kind] !== undefined) await syncDeaConsumables(site, dea, kind)
  }
  res.json(await refreshSchedule(site, req.user._id))
}

/**
 * Déplace la visite à venir d'un site sur une nouvelle date.
 *
 * Sans elle, la fiche client et le planning se contrediraient : la date
 * affichée sur le DAE dirait une chose, la visite planifiée une autre. La
 * visite retenue est la première à venir, à défaut la dernière en retard ; s'il
 * n'y en a aucune, on la crée — une échéance annoncée doit exister quelque part.
 */
async function moveNextVisit(site, when, user) {
  const pending = { site: site._id, status: { $ne: 'termine' }, scheduledDate: { $ne: null } }

  const visit =
    await Intervention.findOne({ ...pending, scheduledDate: { $gte: new Date() } }).sort({ scheduledDate: 1 }) ||
    await Intervention.findOne(pending).sort({ scheduledDate: -1 })

  if (visit) {
    const from = visit.scheduledDate
    visit.scheduledDate = when
    visit.manualDate    = true
    visit.history.push({
      action: 'replanification', user: user._id, userName: user.fullName || user.username,
      details: `Contrôle reporté du ${from ? new Date(from).toLocaleDateString('fr-FR') : '—'} `
             + `au ${when.toLocaleDateString('fr-FR')} depuis la fiche client`,
    })
    await visit.save()
    return visit
  }

  const [client, contract] = await Promise.all([
    Client.findById(site.client).select('name').lean(),
    Contract.findOne({ site: site._id, isActive: true, status: 'actif' }).select('_id').lean(),
  ])

  return Intervention.create({
    client:        site.client,
    clientName:    client?.name,
    site:          site._id,
    siteName:      site.name,
    contract:      contract?._id,
    controlType:   contract ? 'semestriel' : 'hors_contrat',
    scheduledDate: when,
    manualDate:    true,
    status:        'planifie',
    history: [{
      action: 'creation', user: user._id, userName: user.fullName || user.username,
      details: 'Contrôle planifié à la main depuis la fiche client',
    }],
    createdBy:     user._id,
  })
}

/**
 * PUT /api/sites/:id/deas/:deaId/next-control — { date }
 *
 * Fixe l'échéance du prochain contrôle depuis la fiche client, sans passer par
 * le contrat. Une date vide rend la main au calendrier automatique.
 *
 * Une visite couvre le site entier : la date vaut donc pour tous ses appareils,
 * comme le fait déjà le calcul automatique.
 */
async function setNextControl(req, res) {
  const site = await findSite(req, res)
  if (!site) return

  const dea = site.deas.id(req.params.deaId)
  if (!dea) return res.status(404).json({ message: 'DEA introuvable.' })

  const raw = req.body?.date
  if (!raw) {
    // Retour au calendrier automatique : le contrat reprend la main.
    site.deas.forEach(d => { d.nextControlManual = false })
    await site.save()
    await syncSiteControls(site._id, req.user._id)
    return res.json(await Site.findById(site._id))
  }

  const when = new Date(raw)
  if (Number.isNaN(when.getTime())) {
    return res.status(422).json({ message: 'Date de contrôle invalide.' })
  }
  when.setHours(9, 0, 0, 0)      // heure par défaut des visites

  site.deas.forEach(d => {
    d.nextControlDate  = when
    d.nextControlManual = true
  })
  await site.save()
  await moveNextVisit(site, when, req.user)

  res.json(await Site.findById(site._id))
}

async function removeDea(req, res) {
  const site = await findSite(req, res)
  if (!site) return
  const dea = site.deas.id(req.params.deaId)
  if (!dea) return res.status(404).json({ message: 'DEA introuvable.' })
  await releaseItemForDea(dea._id)
  dea.deleteOne()
  await site.save()
  res.json(await refreshSchedule(site, req.user._id))
}

module.exports = {
  getAll, lookup, listDeas, getById, getHistory, getDocumentsFolder,
  create, update, remove, addDea, updateDea, removeDea, setNextControl,
}
