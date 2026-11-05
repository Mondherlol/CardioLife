const Product = require('../models/Product')
const mongoose = require('mongoose')
const { searchRegex: accentRegex } = require('../utils/textSearch')

const PUBLIC_PRODUCT_FIELDS = [
  'name',
  'reference',
  'brand',
  'description',
  'category',
  'deviceMode',
  'salePrice',
  'supplier',
  'images',
  'webCard',
  'createdAt',
  'updatedAt',
].join(' ')

async function getAll(req, res) {
  const { category, brand, supplier, search, page = 1, limit = 20 } = req.query

  const filter = { isActive: true, listedOnWebsite: { $ne: false } }
  if (category) filter.category = category
  if (brand?.trim()) filter.brand = accentRegex(brand)
  if (supplier?.trim()) filter.supplier = accentRegex(supplier)

  const q = search?.trim() || ''
  if (q) {
    const re = accentRegex(q)
    filter.$or = [
      { name: re },
      { reference: re },
      { brand: re },
      { supplier: re },
    ]
  }

  const pageNumber = Math.max(Number(page) || 1, 1)
  const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const skip = (pageNumber - 1) * limitNumber

  const [total, products] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .select(PUBLIC_PRODUCT_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),
  ])

  res.json({
    data: products,
    total,
    page: pageNumber,
    totalPages: Math.ceil(total / limitNumber),
  })
}

async function getById(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Produit introuvable.' })
  }

  const product = await Product.findOne({
    _id: req.params.id,
    isActive: true,
    listedOnWebsite: { $ne: false },
  }).select(PUBLIC_PRODUCT_FIELDS)

  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })
  res.json(product)
}

module.exports = { getAll, getById }
