const mongoose     = require('mongoose')
const Site         = require('../models/Site')
const Client       = require('../models/Client')
const Contract     = require('../models/Contract')
const Product      = require('../models/Product')
const ProductItem  = require('../models/ProductItem')
const Intervention = require('../models/Intervention')
const User         = require('../models/User')
const { toInstallation, findDea, listInstallations } = require('../utils/deaParc')
const { syncDeaWithItem } = require('../utils/productItems')
const { applySerialTracking, completePose, cancelPose, createPoseVisit } = require('../utils/pose')
const { createLinkedFormation } = require('../utils/formationLink')

/* Le parc n'a plus de collection propre : une « installation » est un DEA
   déclaré dans `Site.deas`. Ce contrôleur conserve l'API historique
   /api/installations et la sert depuis les sites.

   La pose elle-même — le passage du technicien — est une visite
   (`Intervention`, `controlType: 'installation'`) qui vise ces DEA par
   `targets`. C'est elle qui passe au planning, se démarre, porte la checklist,
   les photos, le bon signé et la formation ; sa clôture valide les poses. */

function isDeviceManager(user) {
  return user.role === 'superadmin' || user.role === 'admin' || user.permissions?.canManageDevices
}
/* Programmer une pose : qui gère le parc, ou qui planifie les visites. */
function canPlan(user) {
  return isDeviceManager(user) || Boolean(user.permissions?.canManageInterventions)
}
/* Lecture du parc : la fiche client l'affiche, qui gère les clients le lit
   (sans pouvoir poser ni modifier un DEA — la route garde les écritures). */
function canReadParc(user) {
  return isDeviceManager(user) || Boolean(user.permissions?.canManageClients)
}
function isAssignedTech(user, dea) {
  return dea.technician && String(dea.technician?._id || dea.technician) === String(user._id)
}

const who = user => ({ user: user._id, userName: user.fullName || user.username })

/* Champs du DEA pilotés par l'API installations. */
const DEA_FIELDS = [
  'deviceType', 'serialNumber', 'location', 'status', 'scheduledDate',
  'technician', 'technicianName', 'contract', 'contractDate', 'controlType',
  'installationDate', 'nextControlDate', 'batteries', 'electrodes', 'armoire', 'notes',
]

function applyBody(dea, body) {
  DEA_FIELDS.forEach(k => { if (body[k] !== undefined) dea[k] = body[k] })
  // `deviceProduct` côté API ↔ `product` côté DEA.
  if (body.deviceProduct !== undefined) dea.product = body.deviceProduct || null
}

/**
 * Site d'accueil d'une nouvelle pose. On réutilise le site désigné, sinon celui
 * qui porte déjà cette adresse chez le client, sinon on le crée : le parc ne
 * peut pas exister hors d'un site.
 */
async function resolveTargetSite(body, userId) {
  if (body.site) {
    const site = await Site.findById(body.site)
    if (site) return site
  }

  const clientId = body.client
  if (!clientId) return null

  const label = (body.address || body.newSite?.name || '').trim()
  if (label) {
    const existing = await Site.find({ client: clientId, isActive: true })
    const match = existing.find(s =>
      s.name.toLowerCase() === label.toLowerCase() ||
      `${s.name} — ${[s.address?.street, s.address?.city].filter(Boolean).join(', ')}`.toLowerCase() === label.toLowerCase()
    )
    if (match) return match
  }

  const client = await Client.findById(clientId).select('name address')
  if (!client) return null
  return Site.create({
    client:  clientId,
    name:    label || client.name || 'Site principal',
    address: {
      street: body.newSite?.street ?? client.address?.street,
      city:   body.newSite?.city   ?? client.address?.city,
    },
    createdBy: userId,
  })
}

/**
 * Visite d'installation de chaque DEA : la plus récente qui le vise.
 * Rend `{ [deaId]: { _id, status, scheduledDate, … } }`.
 */
async function visitsByDea(deaIds) {
  const ids = (deaIds || []).filter(Boolean)
  if (!ids.length) return {}
  const visits = await Intervention.find({ controlType: 'installation', targets: { $in: ids } })
    .select('targets status scheduledDate startedAt completedDate technicienName fiches.dea fiches.nonPose')
    .sort({ createdAt: -1 })
    .lean()
  const out = {}
  for (const v of visits) {
    for (const t of v.targets || []) {
      const k = String(t)
      if (out[k]) continue
      const fiche = (v.fiches || []).find(f => String(f.dea || '') === k)
      out[k] = {
        _id: v._id, status: v.status, scheduledDate: v.scheduledDate,
        startedAt: v.startedAt, completedDate: v.completedDate,
        technicienName: v.technicienName, nonPose: Boolean(fiche?.nonPose),
      }
    }
  }
  return out
}

async function getAll(req, res) {
  const { search, page = 1, limit = 200, client, status, contract, from, to } = req.query

  const filter = { search, client, status, contract, from, to }
  // Les techniciens ne voient que les poses qui leur sont assignées.
  if (req.user.role === 'technicien') {
    filter.technician = req.user._id
  } else if (!canReadParc(req.user)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  const rows  = await listInstallations(filter)
  const total = rows.length
  const skip  = (Number(page) - 1) * Number(limit)
  const data  = rows.slice(skip, skip + Number(limit))

  // Prochain contrôle réel : contrôle non terminé le plus proche parmi ceux du
  // DEA (hors contrat) ET ceux de son contrat.
  const deaIds      = data.map(i => i._id)
  const contractIds = [...new Set(data.map(i => i.contract).filter(Boolean).map(String))]
  const orConds = [{ installation: { $in: deaIds } }]
  if (contractIds.length) orConds.push({ contract: { $in: contractIds } })

  const [ctrls, visits] = await Promise.all([
    Intervention.find({
      status: { $ne: 'termine' },
      scheduledDate: { $ne: null },
      controlType: { $ne: 'installation' },
      $or: orConds,
    }).select('installation contract controlType scheduledDate').sort({ scheduledDate: 1 }).lean(),
    // Seules les poses prévues ou faites dans l'appli ont une visite.
    visitsByDea(data.filter(i => i.status === 'a_installer' || i.scheduledDate).map(i => i._id)),
  ])

  const nextByDea      = {}
  const nextByContract = {}
  ctrls.forEach(c => {
    if (c.installation) { const k = String(c.installation); if (!nextByDea[k])      nextByDea[k]      = c }
    if (c.contract)     { const k = String(c.contract);     if (!nextByContract[k]) nextByContract[k] = c }
  })

  const withNext = data.map(i => {
    const own = nextByDea[String(i._id)]
    const ctr = i.contract ? nextByContract[String(i.contract)] : null
    let next = null
    if (own && ctr) next = new Date(own.scheduledDate) <= new Date(ctr.scheduledDate) ? own : ctr
    else            next = own || ctr || null
    return {
      ...i,
      nextControl: next ? { scheduledDate: next.scheduledDate, controlType: next.controlType } : null,
      visit: visits[String(i._id)] || null,
    }
  })

  res.json({ data: withNext, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) })
}

async function getById(req, res) {
  const found = await findDea(req.params.id)
  if (!found) return res.status(404).json({ message: 'Installation introuvable.' })
  const { site, dea } = found

  if (!canReadParc(req.user) && !isAssignedTech(req.user, dea)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  await site.populate([
    { path: 'deas.product',            select: 'name category reference' },
    { path: 'deas.batteries.product',  select: 'name category reference' },
    { path: 'deas.electrodes.product', select: 'name category reference' },
    { path: 'deas.technician',         select: 'fullName username' },
  ])

  const inst = toInstallation(site, site.deas.id(req.params.id))

  // Un contrat couvre tous les DAE de son client : à défaut de contrat propre
  // au DAE, c'est le contrat actif du client qui s'applique.
  let contract = null
  if (inst.contract) {
    contract = await Contract.findById(inst.contract).select('contractNumber status').lean()
  }
  if (!contract) {
    contract = await Contract.findOne({ client: site.client?._id || site.client, isActive: true, status: 'actif' })
      .select('contractNumber status').lean()
  }

  const visits = await visitsByDea([dea._id])
  res.json({ ...inst, contract: contract || null, visit: visits[String(dea._id)] || null })
}

async function create(req, res) {
  if (!isDeviceManager(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

  const site = await resolveTargetSite(req.body, req.user._id)
  if (!site) return res.status(422).json({ message: 'Un client est requis pour poser un DAE.' })

  const dea = {}
  applyBody(dea, req.body)
  site.deas.push(dea)
  await site.save()

  const created = site.deas[site.deas.length - 1]

  // Pont stock ↔ parc : l'exemplaire portant ce numéro de série suit la pose —
  // réservé tant qu'elle est planifiée, installé une fois validée.
  try { await syncDeaWithItem(site, created) }
  catch (e) { console.error('Lien stock (create):', e.message) }

  await site.populate('client', 'name address underContract logo')
  const inst = toInstallation(site, created)

  if (inst.status === 'installe' && created.product && created.serialNumber) {
    try { await applySerialTracking(created.product, created.serialNumber, inst.clientName, req.user._id) }
    catch (e) { console.error('Serial tracking (create):', e.message) }
  }

  res.status(201).json(inst)
}

/* ─── Programmer une installation ──────────────────────────── */
/**
 * POST /api/installations/plan
 *
 * Une visite de pose en une fois :
 *  1. les DEA « à installer », un par appareil retenu du stock (réservé au
 *     client ou encore disponible) — plus les DEA déjà prévus qu'on reprogramme ;
 *  2. la visite d'installation qui les vise, au planning, avec son technicien ;
 *  3. la formation des agents du même jour, si elle est demandée.
 *
 * Corps : { client, site | newSite{name,street,city}, scheduledDate, technician,
 *           items[], existingDeas[], others[], location, notes,
 *           withFormation, formationTitle, participantsCount }
 */
async function plan(req, res) {
  try {
    if (!canPlan(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

    const {
      client: clientId, scheduledDate, technician, location, notes,
      items: itemIds = [], existingDeas = [], others: otherIds = [],
      withFormation, formationTitle, participantsCount,
    } = req.body || {}

    const badId = [clientId, req.body.site, technician, ...itemIds, ...existingDeas, ...otherIds]
      .filter(Boolean).find(id => !mongoose.isValidObjectId(id))
    if (badId) return res.status(400).json({ message: 'Sélection invalide. Rechargez la page et refaites votre choix.' })

    if (!clientId)      return res.status(400).json({ message: 'Choisissez le client.' })
    if (!scheduledDate || isNaN(new Date(scheduledDate).getTime())) {
      return res.status(400).json({ message: "Indiquez la date et l'heure de l'installation." })
    }
    if (!itemIds.length && !existingDeas.length) {
      return res.status(400).json({ message: 'Choisissez au moins un défibrillateur à installer.' })
    }

    const client = await Client.findById(clientId).select('name address')
    if (!client) return res.status(404).json({ message: 'Client introuvable.' })

    if (!req.body.site && !req.body.newSite?.name) {
      return res.status(400).json({ message: 'Choisissez le site, ou créez-en un.' })
    }
    const site = await resolveTargetSite(req.body, req.user._id)
    if (!site) return res.status(422).json({ message: 'Site introuvable.' })
    if (String(site.client) !== String(client._id)) {
      return res.status(400).json({ message: "Ce site n'appartient pas à ce client." })
    }

    /* Les appareils à poser : des exemplaires du stock encore à l'entrepôt, et
       pas déjà promis à une autre pose. */
    const items = itemIds.length
      ? await ProductItem.find({ _id: { $in: itemIds } }).populate('product', 'name')
      : []
    if (items.length !== itemIds.length) {
      return res.status(404).json({ message: 'Un des appareils choisis est introuvable dans le stock.' })
    }
    for (const it of items) {
      const label = it.serialNumber || it.product?.name || 'Appareil'
      if (!['disponible', 'reserve'].includes(it.status)) {
        return res.status(409).json({ message: `${label} n'est plus en stock (${it.status}).` })
      }
      const otherClient = it.reservedFor?.client || it.client
      if (it.status === 'reserve' && otherClient && String(otherClient) !== String(client._id)) {
        return res.status(409).json({ message: `${label} est réservé pour un autre client.` })
      }
      if (it.dea) {
        return res.status(409).json({ message: `${label} est déjà prévu pour une autre pose.` })
      }
    }

    const tech = technician ? await User.findById(technician).select('fullName username') : null
    const techName = tech ? (tech.fullName || tech.username) : undefined
    const when = new Date(scheduledDate)

    const othersItems = otherIds.length
      ? await ProductItem.find({ _id: { $in: otherIds } }).populate('product', 'name')
      : []
    const livrer = othersItems.map(o => o.product?.name || o.reference || o.serialNumber).filter(Boolean)

    /* 1. Les DEA à installer. */
    const targets = []
    for (const it of items) {
      site.deas.push({
        product:        it.product?._id || it.product,
        deviceType:     it.product?.name || '',
        serialNumber:   it.serialNumber || '',
        location:       location || '',
        status:         'a_installer',
        scheduledDate:  when,
        technician:     tech?._id || null,
        technicianName: techName || '',
        notes:          notes || '',
      })
      targets.push({ dea: site.deas[site.deas.length - 1], item: it })
    }
    // DEA déjà prévus (reprogrammation d'une pose restée en suspens).
    for (const id of existingDeas) {
      const dea = site.deas.id(id)
      if (!dea) return res.status(404).json({ message: "Un des DAE à reprogrammer n'est pas sur ce site." })
      if (dea.status !== 'a_installer') {
        return res.status(409).json({ message: `${dea.serialNumber || dea.deviceType || 'DAE'} est déjà posé.` })
      }
      dea.scheduledDate  = when
      dea.technician     = tech?._id || dea.technician
      dea.technicianName = techName || dea.technicianName
      targets.push({ dea, item: null })
    }
    await site.save()

    // L'exemplaire suit son DEA : réservé pour ce site jusqu'à la pose.
    for (const { dea, item } of targets) {
      if (!item) continue
      try {
        item.dea = dea._id
        await item.save()
        await syncDeaWithItem(site, dea)
      } catch (e) { console.error('Lien stock (plan):', e.message) }
    }

    /* 2. La visite. */
    const intervention = await createPoseVisit({
      site, client,
      deas:           targets.map(t => t.dea),
      scheduledDate:  when,
      technician:     tech?._id,
      technicianName: techName,
      notes: [notes, livrer.length ? `À livrer : ${livrer.join(', ')}` : ''].filter(Boolean).join('\n'),
      user:  req.user,
    })

    /* 3. La formation du même jour. */
    if (withFormation) {
      try {
        await createLinkedFormation(intervention, { title: formationTitle, participantsCount }, req.user)
      } catch (e) { console.error('Formation liée (plan):', e.message) }
    }

    res.status(201).json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function update(req, res) {
  const found = await findDea(req.params.id)
  if (!found) return res.status(404).json({ message: 'Installation introuvable.' })
  const { site, dea } = found

  if (!isDeviceManager(req.user) && !isAssignedTech(req.user, dea)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  // Le statut ne se change pas via update (utiliser /complete).
  const body = { ...req.body }
  delete body.status

  applyBody(dea, body)
  await site.save()
  res.json(toInstallation(site, dea))
}

/* Valider la pose sans passer par la visite (régularisation au bureau) :
   passe le DEA à « installé ». Applique au passage les champs de la fiche
   fournis (n° série, composants, date…). Le cas normal est la clôture de la
   visite d'installation, qui fait la même chose. */
async function complete(req, res) {
  const found = await findDea(req.params.id)
  if (!found) return res.status(404).json({ message: 'Installation introuvable.' })
  const { site, dea } = found

  if (!isDeviceManager(req.user) && !isAssignedTech(req.user, dea)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  const FICHE_FIELDS = ['serialNumber', 'deviceType', 'location',
    'batteries', 'electrodes', 'nextControlDate', 'controlType', 'notes']
  FICHE_FIELDS.forEach(k => { if (req.body[k] !== undefined) dea[k] = req.body[k] })
  if (req.body.deviceProduct !== undefined) dea.product = req.body.deviceProduct || null

  const clientName = site.client?.name || ''
  await completePose(site, dea, {
    date: req.body.installationDate || new Date(), userId: req.user._id, clientName,
  })

  // La visite qui visait cet appareil ne l'attend plus.
  await Intervention.updateMany(
    { controlType: 'installation', targets: dea._id, status: { $ne: 'termine' } },
    { $push: { history: { ...who(req.user), action: 'modification', date: new Date(),
      details: `Pose validée depuis la fiche du DAE — ${dea.serialNumber || dea.deviceType || 'DAE'}` } } },
  )

  res.json(toInstallation(site, dea))
}

async function remove(req, res) {
  if (!isDeviceManager(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

  const found = await findDea(req.params.id)
  if (!found) return res.status(404).json({ message: 'Installation introuvable.' })
  const { site, dea } = found

  /* Une pose prévue s'annule : l'appareil reste réservé au client, et quitte
     la visite qui devait le poser. */
  if (dea.status === 'a_installer') {
    const deaId = dea._id
    await cancelPose(site, dea, { userId: req.user._id })
    const visits = await Intervention.find({ controlType: 'installation', targets: deaId, status: 'planifie' })
    for (const v of visits) {
      v.targets = (v.targets || []).filter(t => String(t) !== String(deaId))
      if (String(v.installation || '') === String(deaId)) v.installation = undefined
      v.history.push({ ...who(req.user), action: 'modification', details: 'DAE retiré de la pose (pose annulée)' })
      if (!v.targets.length) await v.deleteOne()
      else await v.save()
    }
    return res.json({ message: 'Pose annulée — le matériel reste réservé au client.' })
  }

  dea.deleteOne()
  await site.save()

  res.json({ message: 'Installation supprimée.' })
}

module.exports = { getAll, getById, create, plan, update, complete, remove, canPlan }
