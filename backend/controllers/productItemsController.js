const mongoose        = require('mongoose')
const ProductItem     = require('../models/ProductItem')
const Product         = require('../models/Product')
const StockMovement   = require('../models/StockMovement')
const Site            = require('../models/Site')
const Intervention  = require('../models/Intervention')
const { summarize, syncProductStock, logHistory, detachItemFromParc } = require('../utils/productItems')

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

  /* Une pièce reçue = une ligne. Un lot de cinq batteries tenu sur une seule
     ligne « × 5 » ne laissait suivre ni le statut ni l'appareil de chacune. Le
     n° de lot reste porté par chaque ligne : c'est lui qui les rassemble. */
  const docs = serials.length
    ? serials.map(sn => ({ ...base, serialNumber: sn, quantity: 1 }))
    : Array.from({ length: Math.max(1, Number(quantity) || 1) }, () => ({ ...base, quantity: 1 }))

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

/* Les catégories qui se montent sur un DAE. Ce sont aussi les noms des listes
   correspondantes dans `Site.deas`. */
const CONSUMABLE_KINDS = ['batteries', 'electrodes']

/**
 * Monte l'article sur un DAE du parc et l'inscrit sur la fiche client.
 *
 * Sortir une électrode du stock « pour l'École X » ne disait pas sur lequel de
 * ses appareils elle allait : la fiche client restait vide, et le prochain
 * technicien trouvait une armoire dont personne n'avait noté la pièce. On écrit
 * donc la ligne dans le parc, à l'endroit exact où la checklist ira la lire.
 *
 * Retourne `null` si l'article n'est pas un consommable ou si le DAE est
 * introuvable — l'appelant en tire un refus plutôt qu'un rattachement muet.
 */
async function mountOnDea(item, { deaId, siteId }) {
  const kind = CONSUMABLE_KINDS.includes(item.category) ? item.category : null
  if (!kind) return null

  const site = siteId
    ? await Site.findById(siteId)
    : await Site.findOne({ 'deas._id': deaId })
  const dea = site?.deas?.id(deaId)
  if (!dea) return null

  const product = await Product.findById(item.product).select('name').lean()

  // Une pièce déjà inscrite sur cet appareil ne s'y ajoute pas deux fois.
  const already = (dea[kind] || []).some(l =>
    String(l.product || '') === String(item.product || '')
    && ((item.serialNumber && l.serialNumber === item.serialNumber)
      || (item.lotNumber && l.lotNumber === item.lotNumber)))

  if (!already) {
    dea[kind].push({
      product:      item.product,
      productName:  product?.name || '',
      serialNumber: item.serialNumber || '',
      lotNumber:    item.lotNumber || '',
      expiryDate:   item.expirationDate || undefined,
      // Le genre des électrodes ne se devine pas du stock : il se précise sur
      // la fiche du DAE, où l'appareil et son usage sont connus.
      ...(kind === 'electrodes' ? { kind: '' } : {}),
    })
    await site.save()
  }

  item.dea    = dea._id
  item.site   = site._id
  item.client = site.client
  return { site, dea, kind }
}

/* Ce qui ramène l'article à l'entrepôt : il quitte alors le parc du client. */
const BACK_TO_WAREHOUSE = ['disponible', 'maintenance']

/**
 * Une visite est-elle en cours sur l'appareil que l'on s'apprête à retirer ?
 *
 * Reprendre un DAE dont le contrôle est ouvert laisse une checklist qui décrit
 * un appareil absent, et un technicien qui se déplace pour rien. On refuse, en
 * nommant la visite — le magasin sait alors qui appeler.
 */
async function pendingVisitFor(item) {
  if (!item.dea && !item.site) return null
  const query = {
    status: { $ne: 'termine' },
    $or: [
      ...(item.dea  ? [{ installation: item.dea }] : []),
      ...(item.site ? [{ site: item.site }] : []),
    ],
  }
  return Intervention.findOne(query).sort({ scheduledDate: 1 }).select('scheduledDate siteName status').lean()
}

/**
 * POST /api/product-items/:id/status — les transitions de la fiche article :
 * réserver, libérer, envoyer en maintenance, remettre en stock, vendre, casser.
 */
async function changeStatus(req, res) {
  const { status, note, client, site, contract, until, saleDate, salePrice, dea } = req.body
  if (!ProductItem.STATUSES.includes(status)) {
    return res.status(422).json({ message: 'Statut invalide.' })
  }

  const item = await ProductItem.findById(req.params.id)
  if (!item) return res.status(404).json({ message: 'Article introuvable.' })

  const from = item.status
  if (from === status && status !== 'reserve') {
    return res.status(400).json({ message: `L'article est déjà « ${STATUS_LABELS[status]} ».` })
  }

  /* Une pièce désignée pour un appareil précis y est montée : sortir du stock
     « pour l'École X » sans dire sur quel DAE laissait la fiche client vide, et
     personne ne savait laquelle de ses trois armoires avait été servie. Le
     statut suit le geste réel — « Installé », pas « Vendu ». */
  const mounted = dea ? await mountOnDea(item, { deaId: dea, siteId: site }) : null
  if (dea && !mounted) {
    return res.status(404).json({ message: 'DAE introuvable sur ce site.' })
  }

  const effective = mounted ? 'installe' : status

  /* Retour à l'entrepôt : l'article quitte le client. On vérifie d'abord qu'on
     ne lui reprend pas un appareil dont la visite est en cours, puis on le
     détache du parc — sans quoi la fiche client continuerait de l'afficher. */
  let detached = null
  if (BACK_TO_WAREHOUSE.includes(effective) && (item.dea || item.client)) {
    if (!req.body.force) {
      const visit = await pendingVisitFor(item)
      if (visit) {
        const when = visit.scheduledDate
          ? new Date(visit.scheduledDate).toLocaleDateString('fr-FR')
          : 'sans date'
        return res.status(409).json({
          message: `Une visite est en cours sur ce site (${visit.siteName || 'site'}, ${when}). `
                 + 'Clôturez-la, ou confirmez le retrait malgré tout.',
          needsConfirmation: true,
        })
      }
    }
    detached = await detachItemFromParc(item, { userId: req.user._id })
  }

  item.status = effective

  if (effective === 'reserve') {
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

  if (effective === 'vendu') {
    item.saleDate  = saleDate || new Date()
    item.client    = client || item.client || undefined
    if (salePrice != null && salePrice !== '') item.salePrice = Number(salePrice)
  }
  if (effective === 'disponible') {
    // Retour en stock : on repart d'une ardoise propre côté client.
    item.saleDate = undefined
    item.client   = undefined
    item.site     = undefined
    item.dea      = undefined
  } else if (effective === 'reserve' && client) {
    // Réservé : l'article est déjà « promis » à ce client, la fiche client doit
    // le voir sans attendre la pose.
    item.client = client
  }

  await logHistory(item, {
    action: mounted
      ? `Montée sur un DAE — ${mounted.site.name}`
      : `${STATUS_LABELS[from]} → ${STATUS_LABELS[effective]}`,
    from, to: effective, user: req.user._id,
    note: [
      note,
      detached && (detached.kind === 'dae'
        ? `Retiré du parc de ${detached.site.name}`
        : `Détaché du DAE de ${detached.site.name}`),
    ].filter(Boolean).join(' · '),
  })

  // Une transition entre « en stock » et « sorti » déplace le compteur du modèle.
  if (IN_STOCK_STATUSES.includes(from) !== IN_STOCK_STATUSES.includes(effective)) {
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
        reason:        note || `${STATUS_LABELS[from]} → ${STATUS_LABELS[effective]}`,
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
