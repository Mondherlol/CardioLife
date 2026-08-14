const mongoose        = require('mongoose')
const ProductItem     = require('../models/ProductItem')
const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')

const { IN_STOCK_STATUSES } = ProductItem

const DAY = 86400000

/**
 * Les catégories qui s'ouvrent sur la liste de leurs modèles dans le stock,
 * au lieu de la grille de tuiles. Ce réglage ne concerne plus que l'affichage :
 * tous les produits, quelle que soit leur catégorie, sont tenus à l'article.
 */
async function modelViewSlugs() {
  const cats = await ProductCategory.find({ isActive: true, tracksItems: true }).select('slug')
  return cats.map(c => c.slug)
}

/**
 * Agrège une liste d'articles en les compteurs de la barre du haut.
 *
 * « Disponible » retire aussi le matériel en atelier : réservé et en
 * maintenance sont tous deux indisponibles à la vente, les additionner
 * reviendrait à compter deux fois le même appareil.
 */
function summarize(items = [], { expirySoonDays = 90 } = {}) {
  const now  = Date.now()
  const soon = now + expirySoonDays * DAY

  const s = {
    total: 0, disponible: 0, reserve: 0, maintenance: 0,
    vendu: 0, installe: 0, hs: 0,
    expired: 0, expiringSoon: 0, nextExpiry: null,
  }

  for (const it of items) {
    const qty = it.quantity ?? 1
    s[it.status] = (s[it.status] || 0) + qty
    if (IN_STOCK_STATUSES.includes(it.status)) {
      s.total += qty
      if (it.expirationDate) {
        const t = new Date(it.expirationDate).getTime()
        if (t < now)       s.expired      += qty
        else if (t <= soon) s.expiringSoon += qty
        if (s.nextExpiry == null || t < s.nextExpiry) s.nextExpiry = t
      }
    }
  }

  // `disponible` sort déjà de la boucle : total − réservé − maintenance.
  s.nextExpiry = s.nextExpiry ? new Date(s.nextExpiry) : null
  return s
}

/**
 * Réaligne `Product.stock` sur la somme des articles en stock. Les articles
 * sont la source de vérité pour les catégories à suivi unitaire ; le compteur
 * du produit reste maintenu en miroir pour le tableau de bord, les contrats et
 * le widget de stock, qui le lisent directement.
 */
async function syncProductStock(productId) {
  if (!mongoose.isValidObjectId(productId)) return null

  const [agg] = await ProductItem.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), status: { $in: IN_STOCK_STATUSES } } },
    { $group: { _id: null, n: { $sum: { $ifNull: ['$quantity', 1] } } } },
  ])
  const stock = agg?.n || 0

  return Product.findByIdAndUpdate(productId, { $set: { stock } }, { new: true })
}

/** Ajoute une ligne au journal de vie et enregistre. */
async function logHistory(item, { action, from, to, note, user }) {
  item.history.push({ action, from, to, note, user, date: new Date() })
  return item.save()
}

/**
 * Retrouve l'article correspondant à un DEA du parc. On tente d'abord le lien
 * explicite, puis le numéro de série sur le bon modèle — c'est ce second cas
 * qui rattache les appareils posés avant l'arrivée des articles.
 */
async function findItemForDea(deaId, { product, serialNumber } = {}) {
  if (deaId && mongoose.isValidObjectId(deaId)) {
    const linked = await ProductItem.findOne({ dea: deaId })
    if (linked) return linked
  }
  const sn = String(serialNumber || '').trim()
  if (!sn) return null
  const query = { serialNumber: sn }
  if (product && mongoose.isValidObjectId(product)) query.product = product
  return ProductItem.findOne(query)
}

/**
 * Rattache le DEA à l'exemplaire de stock qui porte le même numéro de série.
 * C'est le pont entre le stock et le parc : une fois posé, l'appareil sort du
 * stock et sa fiche article pointe vers le client et le site.
 *
 * Sans exemplaire correspondant (parc saisi avant le stock, import initial),
 * l'appel ne fait rien.
 */
async function syncDeaWithItem(site, dea) {
  const item = await findItemForDea(dea._id, { product: dea.product, serialNumber: dea.serialNumber })
  if (!item) return

  const wasInStock = IN_STOCK_STATUSES.includes(item.status)
  const from       = item.status

  item.dea    = dea._id
  item.site   = site._id
  item.client = site.client
  // Un appareil seulement planifié reste réservé : il est encore à l'entrepôt.
  item.status = dea.status === 'installe' ? 'installe' : 'reserve'

  if (item.status === 'reserve') {
    item.reservedFor = { client: site.client, note: `Pose planifiée — ${site.name}` }
  } else {
    item.reservedFor = undefined
  }

  if (from !== item.status) {
    await logHistory(item, {
      action: item.status === 'installe' ? 'Installé chez le client' : 'Réservé pour une pose',
      from, to: item.status, note: site.name,
    })
  } else {
    await item.save()
  }

  if (wasInStock && !IN_STOCK_STATUSES.includes(item.status)) await syncProductStock(item.product)
}

module.exports = {
  modelViewSlugs, summarize,
  syncProductStock, logHistory, findItemForDea, syncDeaWithItem,
  IN_STOCK_STATUSES,
}
