const { validationResult } = require('express-validator')
const path          = require('path')
const fs            = require('fs')
const Product       = require('../models/Product')
const StockMovement = require('../models/StockMovement')
const Installation  = require('../models/Installation')

async function getAll(req, res) {
  const { category, brand, supplier, search, page = 1, limit = 20, archived = 'false', lowStock, expiringSoon, expired } = req.query

  const now      = new Date()
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  const filter = { isActive: archived === 'true' ? false : true }
  if (category)               filter.category = category
  if (brand)                  filter.brand    = { $regex: brand,    $options: 'i' }
  if (supplier)               filter.supplier = { $regex: supplier, $options: 'i' }
  const q = search?.trim() || ''
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = { $regex: escaped, $options: 'i' }
    filter.$or = [
      { name:      re },
      { reference: re },
      { brand:     re },
      { supplier:  re },
    ]
  }
  if (lowStock === 'true')    filter.$expr = { $lte: ['$stock', '$alertThreshold'] }
  if (expiringSoon === 'true') filter.expirationDate = { $gte: now, $lte: in60Days }
  if (expired === 'true')     filter.expirationDate = { $lt: now }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Product.countDocuments(filter)

  // When searching: names starting with query bubble up first, then alphabetical
  const products = q
    ? await Product.aggregate([
        { $match: filter },
        { $addFields: {
          _score: { $cond: [
            { $regexMatch: { input: { $ifNull: ['$name', ''] }, regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, options: 'i' } },
            0, 1
          ]}
        }},
        { $sort: { _score: 1, name: 1 } },
        { $skip: skip },
        { $limit: Number(limit) },
        { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: '_creator' } },
        { $addFields: { createdBy: { $arrayElemAt: ['$_creator', 0] } } },
        { $project: { _creator: 0, _score: 0 } },
      ])
    : await Product.find(filter)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 })
        .populate('createdBy', 'username fullName')

  res.json({
    data: products,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  })
}

async function getStats(req, res) {
  const now       = new Date()
  const in60Days  = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  const [total, lowStock, expiringSoon, expired] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({
      isActive: true,
      $expr: { $lte: ['$stock', '$alertThreshold'] },
    }),
    Product.countDocuments({
      isActive: true,
      expirationDate: { $gte: now, $lte: in60Days },
    }),
    Product.countDocuments({
      isActive: true,
      expirationDate: { $lt: now },
    }),
  ])

  res.json({ total, lowStock, expiringSoon, expired })
}

async function getById(req, res) {
  const product = await Product.findById(req.params.id)
    .populate('createdBy', 'username fullName')
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  res.json(product)
}

async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const product = await Product.create({ ...req.body, createdBy: req.user._id })

  if (product.stock > 0) {
    await StockMovement.create({
      product:       product._id,
      type:          'entree',
      quantity:      product.stock,
      previousStock: 0,
      newStock:      product.stock,
      reason:        'Stock initial à la création',
      createdBy:     req.user._id,
    })
  }

  res.status(201).json(product)
}

async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  )
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  res.json(product)
}

async function adjustStock(req, res) {
  const { type, quantity, reason, serialNumbers, lotNumber, expirationDate } = req.body

  if (!['entree', 'sortie', 'ajustement'].includes(type)) {
    return res.status(422).json({ message: 'Type de mouvement invalide.' })
  }
  const qty = Number(quantity)
  if (!qty || qty <= 0) {
    return res.status(422).json({ message: 'La quantité doit être supérieure à 0.' })
  }

  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })

  const previousStock = product.stock

  if (type === 'sortie') {
    if (product.stock < qty) {
      return res.status(400).json({
        message: `Stock insuffisant. Disponible : ${product.stock} unité(s).`,
      })
    }
    product.stock -= qty
  } else if (type === 'entree') {
    product.stock += qty
  } else {
    // ajustement = correction directe
    product.stock = qty
  }

  await product.save()
  await StockMovement.create({
    product:        product._id,
    type,
    quantity:       qty,
    previousStock,
    newStock:       product.stock,
    reason:         reason        || '',
    serialNumbers:  Array.isArray(serialNumbers) ? serialNumbers.filter(Boolean) : [],
    lotNumber:      lotNumber     || undefined,
    expirationDate: expirationDate || undefined,
    createdBy:      req.user._id,
  })

  res.json(product)
}

// Rattache des numéros de série à des unités DÉJÀ en stock (régularisation).
// N'affecte pas la quantité en stock.
async function assignSerials(req, res) {
  const { serialNumbers, reason } = req.body

  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  if (!product.requiresSerialNumber) {
    return res.status(400).json({ message: 'Ce produit ne requiert pas de numéro de série.' })
  }

  const incoming = (Array.isArray(serialNumbers) ? serialNumbers : [])
    .map(sn => String(sn).trim())
    .filter(Boolean)
  if (incoming.length === 0) {
    return res.status(422).json({ message: 'Saisissez au moins un numéro de série.' })
  }

  // Doublons dans la saisie
  const dupes = incoming.filter((sn, i) => incoming.indexOf(sn) !== i)
  if (dupes.length > 0) {
    return res.status(422).json({ message: `Numéros en double : ${[...new Set(dupes)].join(', ')}` })
  }

  // Numéros de série actuellement en stock (entrée + régularisation − sortie)
  const movements = await StockMovement.find({ product: product._id })
  const entered = new Set()
  const exited  = new Set()
  movements.forEach(mv => {
    if (mv.type === 'entree' || mv.type === 'serialisation') mv.serialNumbers?.forEach(sn => entered.add(sn))
    if (mv.type === 'sortie') mv.serialNumbers?.forEach(sn => exited.add(sn))
  })
  const inStock = [...entered].filter(sn => !exited.has(sn))

  // Déjà présents
  const already = incoming.filter(sn => inStock.includes(sn))
  if (already.length > 0) {
    return res.status(409).json({ message: `Déjà en stock : ${already.join(', ')}` })
  }

  // Ne pas dépasser le nombre d'unités sans série
  const untracked = Math.max(0, product.stock - inStock.length)
  if (incoming.length > untracked) {
    return res.status(400).json({
      message: `${untracked} unité(s) sans numéro de série. Vous ne pouvez pas en saisir plus.`,
    })
  }

  await StockMovement.create({
    product:       product._id,
    type:          'serialisation',
    quantity:      incoming.length,
    previousStock: product.stock,
    newStock:      product.stock, // stock inchangé
    reason:        reason || 'Saisie des numéros de série (régularisation)',
    serialNumbers: incoming,
    createdBy:     req.user._id,
  })

  res.json(product)
}

// Unités de ce produit (identifiées par n° de série) actuellement posées chez des clients.
async function getClientStock(req, res) {
  const installs = await Installation.find({
    deviceProduct: req.params.id,
    serialNumber:  { $exists: true, $nin: [null, ''] },
    status:        'installe',
  })
    .select('serialNumber clientName client address location installationDate')
    .populate('client', 'name')
    .sort({ installationDate: -1 })
    .lean()
  res.json(installs)
}

async function getMovements(req, res) {
  const movements = await StockMovement.find({ product: req.params.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('createdBy', 'username fullName')
  res.json(movements)
}

async function archive(req, res) {
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  product.isActive = false
  await product.save()
  res.json({ message: 'Produit archivé.' })
}

async function restore(req, res) {
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  product.isActive = true
  await product.save()
  res.json({ message: 'Produit restauré.' })
}

async function permanentDelete(req, res) {
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  if (product.isActive) {
    return res.status(400).json({
      message: "Archivez d'abord le produit avant de le supprimer définitivement.",
    })
  }
  await StockMovement.deleteMany({ product: product._id })
  await product.deleteOne()
  res.json({ message: 'Produit supprimé définitivement.' })
}

async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' })

  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })

  product.images.push(req.file.filename)
  await product.save()
  res.json(product)
}

async function deleteImage(req, res) {
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })

  const { filename } = req.params
  const idx = product.images.indexOf(filename)
  if (idx === -1) return res.status(404).json({ message: 'Image introuvable.' })

  const filePath = path.join(__dirname, '..', 'uploads', 'products', filename)
  fs.unlink(filePath, () => {})

  product.images.splice(idx, 1)
  await product.save()
  res.json(product)
}

async function getSuppliers(req, res) {
  const suppliers = await Product.distinct('supplier', {
    supplier: { $exists: true, $ne: '' },
  })
  res.json(suppliers.filter(Boolean).sort((a, b) => a.localeCompare(b)))
}

async function getBrands(req, res) {
  const brands = await Product.distinct('brand', {
    brand: { $exists: true, $ne: '' },
  })
  res.json(brands.filter(Boolean).sort((a, b) => a.localeCompare(b)))
}

module.exports = {
  getAll, getStats, getById, create, update,
  adjustStock, assignSerials, getMovements, getClientStock,
  uploadImage, deleteImage,
  archive, restore, permanentDelete,
  getSuppliers, getBrands,
}
