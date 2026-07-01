const Installation = require('../models/Installation')
const Contract     = require('../models/Contract')

async function getAll(req, res) {
  const { search, page = 1, limit = 200, client } = req.query
  const query = {}

  if (client) query.client = client

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
    .populate('createdBy', 'username fullName')

  res.json({ data, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) })
}

async function getById(req, res) {
  const inst = await Installation.findById(req.params.id)
    .populate('client', 'name type address')
    .populate('deviceProduct', 'name category reference')
    .populate('batteries.product', 'name category reference')
    .populate('electrodes.product', 'name category reference')
    .populate('createdBy', 'username fullName')
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })

  // Contrat éventuel dont provient cette installation
  const contract = await Contract.findOne({ installations: inst._id, isActive: true })
    .select('contractNumber type status')
    .lean()

  res.json({ ...inst.toObject(), contract: contract || null })
}

async function create(req, res) {
  const inst = await Installation.create({ ...req.body, createdBy: req.user._id })
  res.status(201).json(inst)
}

async function update(req, res) {
  const inst = await Installation.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  )
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })
  res.json(inst)
}

async function remove(req, res) {
  const inst = await Installation.findByIdAndDelete(req.params.id)
  if (!inst) return res.status(404).json({ message: 'Installation introuvable.' })
  res.json({ message: 'Installation supprimée.' })
}

module.exports = { getAll, getById, create, update, remove }
