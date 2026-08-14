const mongoose        = require('mongoose')
const ProductItem     = require('../models/ProductItem')
const Product         = require('../models/Product')
const StockMovement   = require('../models/StockMovement')
const Site            = require('../models/Site')
const { summarize, syncProductStock, logHistory } = require('../utils/productItems')

const { IN_STOCK_STATUSES, OUT_STATUSES, STATUS_LABELS } = ProductItem

const POPULATE = [
  { path: 'product', select: 'name reference brand category images salePrice purchasePrice alertThreshold' },
  { path: 'client',  select: 'name' },
  { path: 'site',    select: 'name address' },
  { path: 'reservedFor.client',   select: 'name' },
  { path: 'reservedFor.site',     select: 'name address' },
  { path: 'reservedFor.contract', select: 'reference startDate endDate' },
]

/* Filtres communs aux listes. */
function buildFilter(query) {
  const filter = {}
  if (query.product)  filter.product  = query.product
  if (query.category) filter.category = query.category
  if (query.client)   filter.client   = query.client

  if (query.status) {
    const list = String(query.status).split(',').map(s => s.trim()).filter(Boolean)
    filter.status = list.length > 1 ? { $in: list } : list[0]
  }
  // `inStock=true` : tout ce qui occupe une place dans l'entrepôt.
  if (query.inStock === 'true')  filter.status = { $in: IN_STOCK_STATUSES }
  if (query.inStock === 'false') filter.status = { $in: OUT_STATUSES }

  if (query.expiring) {
    const days = Number(query.expiring)
    const now  = new Date()
    filter.expirationDate = query.expiring === 'expired'
      ? { $lt: now }
      : { $gte: now, $lte: new Date(now.getTime() + days * 86400000) }
  }

  const q = String(query.search || '').trim()
  if (q) {
    const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    filter.$or = [{ serialNumber: re }, { reference: re }, { lotNumber: re }, { supplier: re }]
  }
  return filter
}

/* GET /api/product-items — liste détaillée + compteurs de la barre du haut. */
async function getAll(req, res) {
  const filter = buildFilter(req.query)

  // Les compteurs portent sur le périmètre (produit / catégorie), pas sur les
  // filtres de recherche : la barre du haut ne doit pas bouger quand on tape.
  const scope = {}
  if (req.query.product)  scope.product  = req.query.product
  if (req.query.category) scope.category = req.query.category

  const [items, all] = await Promise.all([
    ProductItem.find(filter).populate(POPULATE).sort({ entryDate: -1, createdAt: -1 }).limit(2000),
    ProductItem.find(scope).select('status quantity expirationDate'),
  ])

  res.json({ data: items, total: items.length, summary: summarize(all) })
}

/**
 * GET /api/product-items/models?category=slug
 * Un modèle par ligne, avec ses compteurs — c'est la vue qui s'ouvre au clic
 * sur une catégorie à suivi unitaire.
 */
async function getModels(req, res) {
  const { category } = req.query
  const productFilter = { isActive: true }
  if (category) productFilter.category = category

  const products = await Product.find(productFilter).sort({ name: 1 })
  if (products.length === 0) return res.json([])

  const ids   = products.map(p => p._id)
  const items = await ProductItem.find({ product: { $in: ids } })
    .select('product status quantity expirationDate')

  const byProduct = new Map()
  for (const it of items) {
    const key = String(it.product)
    if (!byProduct.has(key)) byProduct.set(key, [])
    byProduct.get(key).push(it)
  }

  res.json(products.map(p => ({
    ...p.toObject(),
    summary: summarize(byProduct.get(String(p._id)) || []),
  })))
}

/* GET /api/product-items/:id — la fiche article. */
async function getById(req, res) {
  const item = await ProductItem.findById(req.params.id)
    .populate(POPULATE)
    .populate('history.user', 'username fullName')
    .populate('createdBy', 'username fullName')
  if (!item) return res.status(404).json({ message: 'Article introuvable.' })

  // Le DEA vit dans un sous-document de site : on le résout pour la fiche.
  let dea = null
  if (item.dea) {
    const site = await Site.findOne({ 'deas._id': item.dea }).populate('client', 'name')
    const sub  = site?.deas.id(item.dea)
    if (sub) dea = { ...sub.toObject(), site: { _id: site._id, name: site.name, address: site.address }, client: site.client }
  }

  const movement = item.entryMovement
    ? await StockMovement.findById(item.entryMovement).populate('createdBy', 'username fullName')
    : null

  res.json({ ...item.toObject(), dea, entryMovement: movement })
}

/**
 * POST /api/product-items — réception.
 * Accepte `serialNumbers: []` pour créer un exemplaire par numéro, ou une
 * ligne unique (lot, ou article sans série) avec `quantity`.
 */
async function create(req, res) {
  const { product: productId, serialNumbers, quantity, ...rest } = req.body

  const product = await Product.findById(productId)
  if (!product) return res.status(404).json({ message: 'Produit introuvable.' })

  const serials = (Array.isArray(serialNumbers) ? serialNumbers : [])
    .map(sn => String(sn).trim()).filter(Boolean)

  const dupes = serials.filter((sn, i) => serials.indexOf(sn) !== i)
  if (dupes.length) {
    return res.status(422).json({ message: `Numéros en double dans la saisie : ${[...new Set(dupes)].join(', ')}` })
  }
  if (serials.length) {
    const clash = await ProductItem.find({ product: product._id, serialNumber: { $in: serials } }).select('serialNumber')
    if (clash.length) {
      return res.status(409).json({ message: `Déjà enregistré : ${clash.map(c => c.serialNumber).join(', ')}` })
    }
  }

  const base = {
    ...rest,
    product:   product._id,
    category:  product.category,
    reference: rest.reference || product.reference || '',
    supplier:  rest.supplier  || product.supplier  || '',
    entryDate: rest.entryDate || new Date(),
    status:    'disponible',
    createdBy: req.user._id,
    history:   [{ action: 'Entrée en stock', to: 'disponible', note: rest.notes || '', user: req.user._id }],
  }

  const docs = serials.length
    ? serials.map(sn => ({ ...base, serialNumber: sn, quantity: 1 }))
    : [{ ...base, quantity: Math.max(1, Number(quantity) || 1) }]

  const created = await ProductItem.insertMany(docs)

  const totalQty = docs.reduce((n, d) => n + (d.quantity || 1), 0)
  const movement = await StockMovement.create({
    product:        product._id,
    type:           'entree',
    quantity:       totalQty,
    previousStock:  product.stock,
    newStock:       product.stock + totalQty,
    reason:         rest.reason || 'Réception d\'articles',
    serialNumbers:  serials,
    lotNumber:      rest.lotNumber || undefined,
    expirationDate: rest.expirationDate || undefined,
    createdBy:      req.user._id,
  })
  await ProductItem.updateMany({ _id: { $in: created.map(c => c._id) } }, { $set: { entryMovement: movement._id } })

  await syncProductStock(product._id)
  res.status(201).json({ created: created.length, items: created })
}

/* PATCH /api/product-items/:id — édition libre d'une ligne du tableau. */
async function update(req, res) {
  const item = await ProductItem.findById(req.params.id)
  if (!item) return res.status(404).json({ message: 'Article introuvable.' })

  // Le statut a ses propres transitions : il ne se change pas ici en douce.
  const { status, product, history, ...payload } = req.body

  if (payload.serialNumber != null) {
    const sn = String(payload.serialNumber).trim()
    if (sn) {
      const clash = await ProductItem.findOne({ product: item.product, serialNumber: sn, _id: { $ne: item._id } })
      if (clash) return res.status(409).json({ message: `Le numéro de série ${sn} est déjà utilisé.` })
    }
    payload.serialNumber = sn || undefined
  }

  item.set(payload)
  await item.save()
  await syncProductStock(item.product)

  const fresh = await ProductItem.findById(item._id).populate(POPULATE)
  res.json(fresh)
}

/**
 * POST /api/product-items/:id/status — les transitions de la fiche article :
 * réserver, libérer, envoyer en maintenance, remettre en stock, vendre, casser.
 */
async function changeStatus(req, res) {
  const { status, note, client, site, contract, until, saleDate, salePrice } = req.body
  if (!ProductItem.STATUSES.includes(status)) {
    return res.status(422).json({ message: 'Statut invalide.' })
  }

  const item = await ProductItem.findById(req.params.id)
  if (!item) return res.status(404).json({ message: 'Article introuvable.' })

  const from = item.status
  if (from === status && status !== 'reserve') {
    return res.status(400).json({ message: `L'article est déjà « ${STATUS_LABELS[status]} ».` })
  }

  item.status = status

  if (status === 'reserve') {
    item.reservedFor = {
      client:   client   || undefined,
      // Le site destinataire : sans lui, impossible de savoir où poser.
      site:     site     || undefined,
      contract: contract || undefined,
      until:    until    || undefined,
      note:     note     || '',
    }
    // Le site sert aussi à retrouver l'article depuis la fiche du client.
    if (site) item.site = site
  } else {
    // Toute sortie de la réservation efface la consigne.
    item.reservedFor = undefined
  }

  if (status === 'vendu') {
    item.saleDate  = saleDate || new Date()
    item.client    = client || item.client || undefined
    if (salePrice != null && salePrice !== '') item.salePrice = Number(salePrice)
  }
  if (status === 'disponible') {
    // Retour en stock : on repart d'une ardoise propre côté client.
    item.saleDate = undefined
    item.client   = undefined
    item.site     = undefined
    item.dea      = undefined
  } else if (status === 'reserve' && client) {
    // Réservé : l'article est déjà « promis » à ce client, la fiche client doit
    // le voir sans attendre la pose.
    item.client = client
  }

  await logHistory(item, {
    action: `${STATUS_LABELS[from]} → ${STATUS_LABELS[status]}`,
    from, to: status, note, user: req.user._id,
  })

  // Une transition entre « en stock » et « sorti » déplace le compteur du modèle.
  if (IN_STOCK_STATUSES.includes(from) !== IN_STOCK_STATUSES.includes(status)) {
    const product = await Product.findById(item.product)
    if (product) {
      const qty = item.quantity ?? 1
      const isExit = IN_STOCK_STATUSES.includes(from)
      await StockMovement.create({
        product:       product._id,
        type:          isExit ? 'sortie' : 'entree',
        quantity:      qty,
        previousStock: product.stock,
        newStock:      isExit ? product.stock - qty : product.stock + qty,
        reason:        note || `${STATUS_LABELS[from]} → ${STATUS_LABELS[status]}`,
        serialNumbers: item.serialNumber ? [item.serialNumber] : [],
        lotNumber:     item.lotNumber || undefined,
        createdBy:     req.user._id,
      })
    }
    await syncProductStock(item.product)
  }

  const fresh = await ProductItem.findById(item._id).populate(POPULATE)
  res.json(fresh)
}

/* DELETE /api/product-items/:id — retire une saisie erronée. */
async function remove(req, res) {
  const item = await ProductItem.findById(req.params.id)
  if (!item) return res.status(404).json({ message: 'Article introuvable.' })
  const productId = item.product
  await item.deleteOne()
  await syncProductStock(productId)
  res.json({ message: 'Article supprimé.' })
}

module.exports = { getAll, getModels, getById, create, update, changeStatus, remove }
