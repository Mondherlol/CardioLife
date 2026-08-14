const Site         = require('../models/Site')
const Client       = require('../models/Client')
const Contract     = require('../models/Contract')
const Product      = require('../models/Product')
const StockMovement = require('../models/StockMovement')
const ProductItem  = require('../models/ProductItem')
const Intervention = require('../models/Intervention')
const { toInstallation, findDea, listInstallations } = require('../utils/deaParc')
const { syncDeaWithItem } = require('../utils/productItems')

/* Le parc n'a plus de collection propre : une « installation » est un DEA
   déclaré dans `Site.deas`. Ce contrôleur conserve l'API historique
   /api/installations et la sert depuis les sites. */

/* Traçabilité stock du DAE posé : si le n° de série n'est pas en stock, on l'ajoute
   (entrée) puis on le déduit (sortie) ; s'il y est, simple sortie.

   Mécanisme hérité, antérieur aux articles (`ProductItem`). Depuis, ce sont les
   articles qui font foi et `syncProductStock` recalcule `Product.stock` à partir
   d'eux : appliquer les deux décompterait deux fois la même pose. On ne garde
   donc celui-ci que pour les numéros de série inconnus du stock — parc repris
   à la main, import d'historique. */
async function applySerialTracking(deviceProductId, serial, clientName, userId) {
  if (!deviceProductId || !serial) return

  const tracked = await ProductItem.findOne({ serialNumber: String(serial).trim() })
  if (tracked) return

  const product = await Product.findById(deviceProductId)
  if (!product) return

  const movements = await StockMovement.find({ product: product._id }).select('type serialNumbers')
  const entered = new Set(), exited = new Set()
  movements.forEach(mv => {
    if (mv.type === 'entree') (mv.serialNumbers || []).forEach(s => entered.add(s))
    if (mv.type === 'sortie') (mv.serialNumbers || []).forEach(s => exited.add(s))
  })
  const inStock = entered.has(serial) && !exited.has(serial)

  if (!inStock) {
    const prev = product.stock || 0
    product.stock = prev + 1
    await product.save()
    await StockMovement.create({
      product: product._id, type: 'entree', quantity: 1,
      previousStock: prev, newStock: product.stock, serialNumbers: [serial],
      reason: 'Ajout auto avant installation (n° série absent du stock)', createdBy: userId,
    })
  }

  const prev2 = product.stock || 0
  product.stock = Math.max(0, prev2 - 1)
  await product.save()
  await StockMovement.create({
    product: product._id, type: 'sortie', quantity: 1,
    previousStock: prev2, newStock: product.stock, serialNumbers: [serial],
    reason: `Sortie pour installation${clientName ? ` — ${clientName}` : ''}`, createdBy: userId,
  })
}

function isDeviceManager(user) {
  return user.role === 'superadmin' || user.role === 'admin' || user.permissions?.canManageDevices
}
function isAssignedTech(user, dea) {
  return dea.technician && String(dea.technician?._id || dea.technician) === String(user._id)
}

/* Champs du DEA pilotés par l'API installations. */
const DEA_FIELDS = [
  'deviceType', 'serialNumber', 'location', 'status', 'scheduledDate',
  'technician', 'technicianName', 'contract', 'contractDate', 'controlType',
  'installationDate', 'nextControlDate', 'batteries', 'electrodes', 'notes',
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

  const label = (body.address || '').trim()
  if (label) {
    const existing = await Site.find({ client: clientId, isActive: true })
    const match = existing.find(s =>
      s.name.toLowerCase() === label.toLowerCase() ||
      `${s.name} — ${[s.address?.street, s.address?.city].filter(Boolean).join(', ')}`.toLowerCase() === label.toLowerCase()
    )
    if (match) return match
  }

  const client = await Client.findById(clientId).select('name address')
  return Site.create({
    client:  clientId,
    name:    label || client?.name || 'Site principal',
    address: { street: client?.address?.street, city: client?.address?.city },
    createdBy: userId,
  })
}

async function getAll(req, res) {
  const { search, page = 1, limit = 200, client, status, contract, from, to } = req.query

  const filter = { search, client, status, contract, from, to }
  // Les techniciens ne voient que les poses qui leur sont assignées.
  if (req.user.role === 'technicien') {
    filter.technician = req.user._id
  } else if (!isDeviceManager(req.user)) {
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

  const ctrls = await Intervention.find({
    status: { $ne: 'termine' },
    scheduledDate: { $ne: null },
    $or: orConds,
  }).select('installation contract controlType scheduledDate').sort({ scheduledDate: 1 }).lean()

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
    }
  })

  res.json({ data: withNext, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) })
}

async function getById(req, res) {
  const found = await findDea(req.params.id)
  if (!found) return res.status(404).json({ message: 'Installation introuvable.' })
  const { site, dea } = found

  if (!isDeviceManager(req.user) && !isAssignedTech(req.user, dea)) {
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

  res.json({ ...inst, contract: contract || null })
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

/* Valider la pose : passe le DEA à « installé ». Applique au passage les champs
   de la fiche fournis (n° série, composants, date…). */
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

  dea.status = 'installe'
  dea.installationDate = req.body.installationDate || new Date()
  await site.save()

  // La pose validée sort l'exemplaire du stock et le rattache au site.
  try { await syncDeaWithItem(site, dea) }
  catch (e) { console.error('Lien stock (complete):', e.message) }

  const inst = toInstallation(site, dea)

  if (dea.product && dea.serialNumber) {
    try { await applySerialTracking(dea.product, dea.serialNumber, inst.clientName, req.user._id) }
    catch (e) { console.error('Serial tracking (complete):', e.message) }
  }

  res.json(inst)
}

async function remove(req, res) {
  if (!isDeviceManager(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

  const found = await findDea(req.params.id)
  if (!found) return res.status(404).json({ message: 'Installation introuvable.' })
  const { site, dea } = found

  dea.deleteOne()
  await site.save()

  res.json({ message: 'Installation supprimée.' })
}

module.exports = { getAll, getById, create, update, complete, remove }
