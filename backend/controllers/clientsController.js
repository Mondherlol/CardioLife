const { validationResult } = require('express-validator')
const Client = require('../models/Client')

async function getAll(req, res) {
  const { governorate, type, search, q, page = 1, limit = 20, archived = 'false', sort = 'createdAt', dir = 'desc' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  if (governorate) filter['address.governorate'] = governorate
  if (type) {
    const types = String(type).split(',').map(t => t.trim()).filter(Boolean)
    filter.type = types.length > 1 ? { $in: types } : types[0]
  }
  if (search)      filter.$text = { $search: search }
  if (q)           filter.name  = { $regex: q, $options: 'i' }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Client.countDocuments(filter)
  const sortFields = {
    name:        'name',
    type:        'type',
    governorate: 'address.governorate',
    contactName: 'contact.name',
    phone:       'contact.phones.0',
    createdAt:   'createdAt',
  }
  const sortKey = sortFields[sort] || sortFields.createdAt
  const sortDir = dir === 'asc' ? 1 : -1
  const clients = await Client.find(filter)
    .skip(skip)
    .limit(Number(limit))
    .sort({ [sortKey]: sortDir, createdAt: -1 })
    .collation({ locale: 'fr', strength: 1 })
    .populate('createdBy', 'username fullName')

  res.json({
    data: clients,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  })
}

async function getById(req, res) {
  const client = await Client.findById(req.params.id)
    .populate('createdBy', 'username fullName')
    .populate('linkedDocuments', 'name mimeType size type storageKey createdAt')
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  res.json(client)
}

async function updateDocuments(req, res) {
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(422).json({ message: 'ids requis.' })
  const client = await Client.findByIdAndUpdate(
    req.params.id,
    { $set: { linkedDocuments: ids } },
    { new: true }
  ).populate('linkedDocuments', 'name mimeType size type storageKey createdAt')
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  res.json(client)
}

async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const client = await Client.create({ ...req.body, createdBy: req.user._id })
  res.status(201).json(client)
}

async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const client = await Client.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  )
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  res.json(client)
}

async function archive(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  client.isActive = false
  await client.save()
  res.json({ message: 'Client archivé.' })
}

async function restore(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  client.isActive = true
  await client.save()
  res.json({ message: 'Client restauré.' })
}

async function permanentDelete(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  if (client.isActive) {
    return res.status(400).json({ message: 'Archivez d\'abord le client avant de le supprimer définitivement.' })
  }
  await client.deleteOne()
  res.json({ message: 'Client supprimé définitivement.' })
}

module.exports = { getAll, getById, create, update, archive, restore, permanentDelete, updateDocuments }
