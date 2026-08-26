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
    /* Le DAE porte aussi ses consommables : sans filtrer sur le modèle, on
       ramènerait une batterie là où l'appareil est attendu. */
    const linked = await ProductItem.findOne(
      product && mongoose.isValidObjectId(product) ? { dea: deaId, product } : { dea: deaId }
    )
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

/** Une ligne du parc et un article de stock désignent-ils la même pièce ? */
function samePiece(line, item) {
  if (String(line.product || '') !== String(item.product || '')) return false
  if (line.serialNumber && item.serialNumber) return line.serialNumber === item.serialNumber
  if (line.lotNumber && item.lotNumber)       return line.lotNumber === item.lotNumber
  return false
}

/**
 * Détache une unité d'un article de stock qui en porte plusieurs.
 *
 * Les réceptions créent une ligne par pièce, mais un lot entré avant ce
 * changement peut encore en porter cinq : on ne va pas sortir les cinq du stock
 * parce qu'une seule est montée sur un DAE.
 */
async function takeOneUnit(item) {
  if ((item.quantity ?? 1) <= 1) return item

  const copy = item.toObject()
  delete copy._id
  delete copy.createdAt
  delete copy.updatedAt
  copy.quantity = 1
  copy.history  = [{ action: 'Unité détachée du lot', to: item.status, date: new Date() }]

  const [unit] = await ProductItem.insertMany([copy])
  item.quantity -= 1
  await item.save()
  return unit
}

/**
 * Aligne le stock sur les consommables déclarés d'un DAE.
 *
 * Déclarer la batterie montée sur un appareil, c'est la sortir du stock : elle
 * est chez le client, pas à l'entrepôt. Sans ce pont, la liste des articles
 * continuait d'annoncer cinq batteries disponibles alors que l'une d'elles
 * était posée — et personne ne savait chez qui.
 *
 * Le mouvement va dans les deux sens : une pièce retirée de la fiche du DAE
 * retourne au stock. Une pièce absente du stock (parc repris, saisie
 * antérieure) ne bloque rien : il n'y a simplement rien à décompter.
 *
 * `kind` vaut 'batteries' ou 'electrodes' — c'est aussi le slug de la catégorie
 * du catalogue, qui distingue ces articles de l'appareil lui-même.
 */
async function syncDeaConsumables(site, dea, kind) {
  const lines = (dea[kind] || []).filter(l => l.product && (l.serialNumber || l.lotNumber))
  const attached = await ProductItem.find({ dea: dea._id, category: kind })

  // 1. Ce qui n'est plus déclaré sur l'appareil retourne au stock.
  for (const item of attached) {
    if (lines.some(l => samePiece(l, item))) continue
    const from = item.status
    item.dea = undefined; item.site = undefined; item.client = undefined
    item.reservedFor = undefined
    item.activationDate = undefined
    item.status = 'disponible'
    await logHistory(item, { action: 'Retour en stock (retirée du DAE)', from, to: 'disponible', note: site.name })
    await syncProductStock(item.product)
  }

  // 2. Ce qui vient d'être déclaré sort du stock, une unité par ligne.
  for (const line of lines) {
    const already = attached.find(item => samePiece(line, item))
    if (already) {
      // Corriger la date d'activation sur la fiche client la corrige au stock.
      const wanted = line.activationDate ? new Date(line.activationDate).getTime() : null
      const held   = already.activationDate ? new Date(already.activationDate).getTime() : null
      if (wanted !== held) {
        already.activationDate = line.activationDate || undefined
        await already.save()
      }
      continue
    }

    const query = {
      product:  line.product,
      status:   { $in: IN_STOCK_STATUSES },
      dea:      null,
      ...(line.serialNumber ? { serialNumber: line.serialNumber } : { lotNumber: line.lotNumber }),
    }
    // La DLC la plus proche part la première.
    const found = await ProductItem.findOne(query).sort({ expirationDate: 1, entryDate: 1 })
    if (!found) continue

    const unit = await takeOneUnit(found)
    const from = unit.status
    unit.dea    = dea._id
    unit.site   = site._id
    unit.client = site.client
    unit.status = 'installe'
    unit.reservedFor = undefined
    // La mise en service se saisit sur la fiche du DAE : le stock la recopie
    // plutôt que d'inventer une date de pose.
    if (line.activationDate) unit.activationDate = line.activationDate
    await logHistory(unit, {
      action: 'Montée sur un DAE',
      from, to: 'installe',
      note: [site.name, dea.deviceType || dea.serialNumber].filter(Boolean).join(' · '),
    })
    await syncProductStock(unit.product)
  }
}

module.exports = {
  modelViewSlugs, summarize,
  syncProductStock, logHistory, findItemForDea, syncDeaWithItem, syncDeaConsumables,
  IN_STOCK_STATUSES,
}
