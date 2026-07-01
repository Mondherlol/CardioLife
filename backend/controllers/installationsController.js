const Installation = require('../models/Installation')
const Contract     = require('../models/Contract')
const Product      = require('../models/Product')
const StockMovement = require('../models/StockMovement')
const Intervention = require('../models/Intervention')

/* Traçabilité stock du DAE posé : si le n° de série n'est pas en stock, on l'ajoute
   (entrée) puis on le déduit (sortie) ; s'il y est, simple sortie. */
async function applySerialTracking(deviceProductId, serial, clientName, userId) {
  if (!deviceProductId || !serial) return
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
function isAssignedTech(user, inst) {
  return inst.technician && String(inst.technician?._id || inst.technician) === String(user._id)
}

async function getAll(req, res) {
  const { search, page = 1, limit = 200, client, status, contract, from, to } = req.query
  const query = {}

  // Les techniciens ne voient que les installations (poses) qui leur sont assignées
  if (req.user.role === 'technicien') {
    query.technician = req.user._id
  } else if (!isDeviceManager(req.user)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  if (client)   query.client   = client
  if (status)   query.status   = status
  if (contract) query.contract = contract

  // Plage de dates (planning) — sur la date de pose planifiée
  if (from || to) {
    query.scheduledDate = {}
    if (from) query.scheduledDate.$gte = new Date(from)
    if (to)   query.scheduledDate.$lte = new Date(to)
  }

  if (search) {
    query.$or = [
      { clientName:   { $regex: search, $options: 'i' } },
      { address:      { $regex: search, $options: 'i' } },
      { location:     { $regex: search, $options: 'i' } },
      { serialNumber: { $regex: search, $options: 'i' } },
      { deviceType:   { $regex: search, $options: 'i' } },
    ]
  }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Installation.countDocuments(query)
  const data  = await Installation.find(query)
    .sort({ clientName: 1, address: 1, location: 1 })
    .skip(skip)
    .limit(Number(limit))
    .populate('client', 'name type address')
    .populate('deviceProduct', 'name category reference')
    .populate('batteries.product', 'name category reference')
    .populate('electrodes.product', 'name category reference')
    .populate('technician', 'fullName username')
    .populate('createdBy', 'username fullName')

  // Prochain contrôle réel de chaque installation : contrôle non terminé le plus
  // proche parmi ses contrôles propres (hors contrat) ET ceux de son contrat.
  const instIds     = data.map(i => i._id)
  const contractIds = [...new Set(data.map(i => i.contract).filter(Boolean).map(String))]
  const orConds = [{ installation: { $in: instIds } }]
  if (contractIds.length) orConds.push({ contract: { $in: contractIds } })

  const ctrls = await Intervention.find({
    status: { $ne: 'termine' },
    scheduledDate: { $ne: null },
    $or: orConds,
  }).select('installation contract controlType scheduledDate').sort({ scheduledDate: 1 }).lean()

  const nextByInst     = {}   // instId -> plus proche contrôle propre
  const nextByContract = {}   // contractId -> plus proche contrôle du contrat
  ctrls.forEach(c => {
    if (c.installation) { const k = String(c.installation); if (!nextByInst[k])     nextByInst[k]     = c }
    if (c.contract)     { const k = String(c.contract);     if (!nextByContract[k]) nextByContract[k] = c }
  })

  const withNext = data.map(i => {
    const obj  = i.toObject()
    const own  = nextByInst[String(i._id)]
    const ctr  = i.contract ? nextByContract[String(i.contract)] : null
    let next = null
    if (own && ctr)  next = new Date(own.scheduledDate) <= new Date(ctr.scheduledDate) ? own : ctr
    else             next = own || ctr || null
    obj.nextControl = next ? { scheduledDate: next.scheduledDate, controlType: next.controlType } : null
    return obj
  })

  res.json({ data: withNext, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) })
}

async function getById(req, res) {
  const inst = await Installation.findById(req.params.id)
    .populate('client', 'name type address')
    .populate('deviceProduct', 'name category reference')
    .populate('batteries.product', 'name category reference')
    .populate('electrodes.product', 'name category reference')
    .populate('technician', 'fullName username')
    .populate('createdBy', 'username fullName')
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })

  if (!isDeviceManager(req.user) && !isAssignedTech(req.user, inst)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  // Contrat lié (champ direct, sinon lookup inverse pour les données historiques)
  let contract = null
  if (inst.contract) {
    contract = await Contract.findById(inst.contract).select('contractNumber status').lean()
  } else {
    contract = await Contract.findOne({ installations: inst._id, isActive: true })
      .select('contractNumber status').lean()
  }

  res.json({ ...inst.toObject(), contract: contract || null })
}

async function create(req, res) {
  if (!isDeviceManager(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

  const inst = await Installation.create({ ...req.body, createdBy: req.user._id })

  // Si l'installation appartient à un contrat, on la référence côté contrat
  if (inst.contract) {
    await Contract.updateOne({ _id: inst.contract }, { $addToSet: { installations: inst._id } })
  }

  // Pose directe (déjà installée) → traçabilité stock du n° de série
  if (inst.status === 'installe' && inst.deviceProduct && inst.serialNumber) {
    try { await applySerialTracking(inst.deviceProduct, inst.serialNumber, inst.clientName, req.user._id) }
    catch (e) { console.error('Serial tracking (create):', e.message) }
  }

  res.status(201).json(inst)
}

async function update(req, res) {
  const inst = await Installation.findById(req.params.id)
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })
  if (!isDeviceManager(req.user) && !isAssignedTech(req.user, inst)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  // Le statut ne se change pas via update (utiliser /complete)
  const body = { ...req.body }
  delete body.status

  Object.assign(inst, body)
  await inst.save()
  res.json(inst)
}

/* Valider la pose : passe l'installation à « installé ». Applique au passage
   les champs de la fiche fournis (n° série, composants, date…). */
async function complete(req, res) {
  const inst = await Installation.findById(req.params.id)
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })
  if (!isDeviceManager(req.user) && !isAssignedTech(req.user, inst)) {
    return res.status(403).json({ message: 'Accès refusé.' })
  }

  const FICHE_FIELDS = ['serialNumber', 'deviceProduct', 'deviceType', 'address', 'location',
    'batteries', 'electrodes', 'nextControlDate', 'controlType', 'notes']
  FICHE_FIELDS.forEach(k => { if (req.body[k] !== undefined) inst[k] = req.body[k] })

  inst.status = 'installe'
  inst.installationDate = req.body.installationDate || new Date()
  await inst.save()

  // Traçabilité stock du n° de série posé
  if (inst.deviceProduct && inst.serialNumber) {
    try { await applySerialTracking(inst.deviceProduct, inst.serialNumber, inst.clientName, req.user._id) }
    catch (e) { console.error('Serial tracking (complete):', e.message) }
  }

  res.json(inst)
}

async function remove(req, res) {
  if (!isDeviceManager(req.user)) return res.status(403).json({ message: 'Accès refusé.' })
  const inst = await Installation.findByIdAndDelete(req.params.id)
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })
  // Retire la référence côté contrat
  if (inst.contract) {
    await Contract.updateOne({ _id: inst.contract }, { $pull: { installations: inst._id } })
  }
  res.json({ message: 'Installation supprimée.' })
}

module.exports = { getAll, getById, create, update, complete, remove }
