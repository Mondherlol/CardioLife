const { validationResult } = require('express-validator')
const Pack    = require('../models/Pack')

const PRODUCT_FIELDS = 'name reference brand category salePrice images stock'

// Normalise le corps de la requête : ne garde que les produits/services valides.
function sanitizeBody(body) {
  const products = Array.isArray(body.products)
    ? body.products
        .filter(p => p && p.product)
        .map(p => ({ product: p.product, quantity: Math.max(1, Number(p.quantity) || 1) }))
    : []

  const services = Array.isArray(body.services)
    ? body.services
        .filter(s => s && s.name?.trim())
        .map(s => ({ name: s.name.trim(), price: Math.max(0, Number(s.price) || 0) }))
    : []

  const out = {
    name:        body.name?.trim(),
    description: body.description?.trim() || undefined,
    products,
    services,
  }
  if (body.realPrice !== undefined && body.realPrice !== '') {
    out.realPrice = Math.max(0, Number(body.realPrice) || 0)
  } else {
    out.realPrice = undefined
  }
  return out
}

async function getAll(req, res) {
  const { search, page = 1, limit = 20, archived = 'false' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  const q = search?.trim() || ''
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.name = { $regex: escaped, $options: 'i' }
  }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Pack.countDocuments(filter)

  const packs = await Pack.find(filter)
    .skip(skip)
    .limit(Number(limit))
    .sort({ createdAt: -1 })
    .populate('products.product', PRODUCT_FIELDS)
    .populate('createdBy', 'username fullName')

  res.json({
    data:       packs,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  })
}

async function getById(req, res) {
  const pack = await Pack.findById(req.params.id)
    .populate('products.product', PRODUCT_FIELDS)
    .populate('createdBy', 'username fullName')
  if (!pack) return res.status(404).json({ message: 'Pack introuvable.' })
  res.json(pack)
}

async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const pack = await Pack.create({ ...sanitizeBody(req.body), createdBy: req.user._id })
  const populated = await Pack.findById(pack._id)
    .populate('products.product', PRODUCT_FIELDS)
    .populate('createdBy', 'username fullName')
  res.status(201).json(populated)
}

async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const pack = await Pack.findByIdAndUpdate(
    req.params.id,
    { $set: sanitizeBody(req.body) },
    { new: true, runValidators: true }
  )
    .populate('products.product', PRODUCT_FIELDS)
    .populate('createdBy', 'username fullName')
  if (!pack) return res.status(404).json({ message: 'Pack introuvable.' })
  res.json(pack)
}

async function archive(req, res) {
  const pack = await Pack.findById(req.params.id)
  if (!pack) return res.status(404).json({ message: 'Pack introuvable.' })
  pack.isActive = false
  await pack.save()
  res.json({ message: 'Pack archivé.' })
}

async function restore(req, res) {
  const pack = await Pack.findById(req.params.id)
  if (!pack) return res.status(404).json({ message: 'Pack introuvable.' })
  pack.isActive = true
  await pack.save()
  res.json({ message: 'Pack restauré.' })
}

async function permanentDelete(req, res) {
  const pack = await Pack.findById(req.params.id)
  if (!pack) return res.status(404).json({ message: 'Pack introuvable.' })
  if (pack.isActive) {
    return res.status(400).json({
      message: "Archivez d'abord le pack avant de le supprimer définitivement.",
    })
  }
  await pack.deleteOne()
  res.json({ message: 'Pack supprimé définitivement.' })
}

module.exports = {
  getAll, getById, create, update,
  archive, restore, permanentDelete,
}
