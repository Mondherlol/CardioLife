const { validationResult } = require('express-validator')
const ProductCategory = require('../models/ProductCategory')
const Product         = require('../models/Product')

/* Catégories créées au premier démarrage si la collection est vide. */
const DEFAULTS = [
  { name: 'Défibrillateurs', slug: 'defibrillateurs', icon: 'HeartPulse',     color: 'orange', tracksSerial: true,  tracksItems: true, order: 1 },
  { name: 'Armoires',        slug: 'armoires',        icon: 'Archive',        color: 'teal',   order: 2 },
  { name: 'Électrodes',      slug: 'electrodes',      icon: 'Zap',            color: 'blue',   tracksLot: true, tracksItems: true, order: 3 },
  { name: 'Batteries',       slug: 'batteries',       icon: 'BatteryMedium',  color: 'amber',  tracksLot: true, tracksItems: true, order: 4 },
  { name: 'Signalétiques',   slug: 'signaletiques',   icon: 'Signpost',       color: 'green',  order: 5 },
  { name: 'Autres produits', slug: 'autres',          icon: 'Package',        color: 'gray',   order: 6 },
]

/* Anciennes valeurs du champ `category` → nouvelles catégories. Appliqué une
   seule fois, au moment où les catégories par défaut sont créées. */
const LEGACY_MAP = {
  defibrillateur:    'defibrillateurs',
  batterie:          'batteries',
  electrodes_adulte: 'electrodes',
  electrodes_enfant: 'electrodes',
  boitier:           'armoires',
  signaletique:      'signaletiques',
  accessoire:        'autres',
  kit_secours:       'autres',
  mannequin:         'autres',
  trainer:           'autres',
  autre:             'autres',
}

async function seedIfEmpty() {
  if (await ProductCategory.countDocuments()) return
  await ProductCategory.insertMany(DEFAULTS)
  for (const [legacy, slug] of Object.entries(LEGACY_MAP)) {
    await Product.updateMany({ category: legacy }, { $set: { category: slug } })
  }
  console.log('Catégories produits initialisées et produits existants rattachés.')
}

function slugify(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/* GET /api/product-categories?withStats=true */
async function getAll(req, res) {
  await seedIfEmpty()

  const categories = await ProductCategory.find({ isActive: true }).sort({ order: 1, name: 1 })
  if (req.query.withStats !== 'true') return res.json(categories)

  const now      = new Date()
  const in60Days = new Date(now.getTime() + 60 * 86400000)

  const agg = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: {
      _id: '$category',
      products: { $sum: 1 },
      units:    { $sum: '$stock' },
      lowStock: { $sum: { $cond: [{ $lte: ['$stock', '$alertThreshold'] }, 1, 0] } },
      expiringSoon: { $sum: { $cond: [
        { $and: [
          { $ne: ['$expirationDate', null] },
          { $gte: ['$expirationDate', now] },
          { $lte: ['$expirationDate', in60Days] },
        ] }, 1, 0] } },
      expired: { $sum: { $cond: [
        { $and: [
          { $ne: ['$expirationDate', null] },
          { $lt: ['$expirationDate', now] },
        ] }, 1, 0] } },
    } },
  ])

  const statsBySlug = Object.fromEntries(agg.map(a => [a._id, a]))
  const empty = { products: 0, units: 0, lowStock: 0, expiringSoon: 0, expired: 0 }

  res.json(categories.map(c => ({
    ...c.toObject(),
    stats: { ...empty, ...statsBySlug[c.slug], _id: undefined },
  })))
}

async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const slug = slugify(req.body.slug || req.body.name)
  if (await ProductCategory.findOne({ slug })) {
    return res.status(409).json({ message: 'Une catégorie porte déjà ce nom.' })
  }

  const last = await ProductCategory.findOne().sort({ order: -1 }).select('order')
  const category = await ProductCategory.create({
    ...req.body,
    slug,
    order: req.body.order ?? (last ? last.order + 1 : 1),
  })
  res.status(201).json(category)
}

async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  // Le slug est la clé de rattachement des produits : il ne bouge pas.
  const { slug, ...payload } = req.body

  const category = await ProductCategory.findByIdAndUpdate(
    req.params.id,
    { $set: payload },
    { new: true, runValidators: true }
  )
  if (!category) return res.status(404).json({ message: 'Catégorie introuvable.' })
  res.json(category)
}

async function remove(req, res) {
  const category = await ProductCategory.findById(req.params.id)
  if (!category) return res.status(404).json({ message: 'Catégorie introuvable.' })

  const count = await Product.countDocuments({ category: category.slug, isActive: true })
  if (count > 0) {
    return res.status(400).json({
      message: `${count} produit${count > 1 ? 's sont rattachés' : ' est rattaché'} à cette catégorie. Déplacez-les avant de la supprimer.`,
    })
  }

  await category.deleteOne()
  res.json({ message: 'Catégorie supprimée.' })
}

/* PUT /api/product-categories/reorder — body: { ids: [...] } */
async function reorder(req, res) {
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(400).json({ message: 'Liste d\'identifiants attendue.' })
  await Promise.all(ids.map((id, i) => ProductCategory.findByIdAndUpdate(id, { order: i + 1 })))
  const categories = await ProductCategory.find({ isActive: true }).sort({ order: 1, name: 1 })
  res.json(categories)
}

module.exports = { getAll, create, update, remove, reorder, seedIfEmpty }
