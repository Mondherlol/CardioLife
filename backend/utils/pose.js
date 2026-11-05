const Product       = require('../models/Product')
const ProductItem   = require('../models/ProductItem')
const StockMovement = require('../models/StockMovement')
const Intervention  = require('../models/Intervention')
const { syncDeaWithItem, logHistory } = require('./productItems')
const { syncSiteControls } = require('./controls')

/**
 * Cycle de vie d'une pose de DAE, partagé par les deux chemins qui la
 * valident : la clôture de la visite d'installation (le cas normal) et la
 * validation directe depuis la fiche du DAE (régularisation au bureau).
 */

/* Traçabilité stock du DAE posé : si le n° de série n'est pas en stock, on l'ajoute
   (entrée) puis on le déduit (sortie) ; s'il y est, simple sortie.

   Mécanisme hérité, antérieur aux articles (`ProductItem`). Depuis, ce sont les
   articles qui font foi et `syncProductStock` recalcule `Product.stock` à partir
   d'eux : appliquer les deux décompterait deux fois la même pose. On ne garde
   donc celui-ci que pour les numéros de série inconnus du stock — parc repris
   à la main, import d'historique. */
async function applySerialTracking(deviceProductId, serial, clientName, userId) {
  if (!deviceProductId || !serial) return

  const tracked = await ProductItem.findOne({ serialNumber: String(serial).trim() })
  if (tracked) return

  const product = await Product.findById(deviceProductId)
  if (!product) return

  const movements = await StockMovement.find({ product: product._id }).select('type serialNumbers')
  const entered = new Set(), exited = new Set()
  movements.forEach(mv => {
    if (mv.type === 'entree') (mv.serialNumbers || []).forEach(s => entered.add(s))
    if (mv.type === 'sortie') (mv.serialNumbers || []).forEach(s => exited.add(s))
  })
  const inStock = entered.has(serial) && !exited.has(serial)

  if (!inStock) {
    const prev = product.stock || 0
    product.stock = prev + 1
    await product.save()
    await StockMovement.create({
      product: product._id, type: 'entree', quantity: 1,
      previousStock: prev, newStock: product.stock, serialNumbers: [serial],
      reason: 'Ajout auto avant installation (n° série absent du stock)', createdBy: userId,
    })
  }

  const prev2 = product.stock || 0
  product.stock = Math.max(0, prev2 - 1)
  await product.save()
  await StockMovement.create({
    product: product._id, type: 'sortie', quantity: 1,
    previousStock: prev2, newStock: product.stock, serialNumbers: [serial],
    reason: `Sortie pour installation${clientName ? ` — ${clientName}` : ''}`, createdBy: userId,
  })
}

/**
 * Valide la pose d'un DEA : il passe « installé » à la date donnée, et
 * l'exemplaire du stock sort de la réservation pour être rattaché au site.
 *
 * `site` doit être un document Mongoose (il est enregistré ici). Rejouer
 * l'appel sur un DEA déjà posé ne refait pas la sortie de stock.
 */
async function completePose(site, dea, { date, userId, clientName, syncControls = true } = {}) {
  const already = dea.status === 'installe'
  dea.status = 'installe'
  dea.installationDate = date || dea.installationDate || new Date()
  await site.save()

  if (already) return

  // La pose validée sort l'exemplaire du stock et le rattache au site.
  try { await syncDeaWithItem(site, dea) }
  catch (e) { console.error('Lien stock (pose):', e.message) }

  if (dea.product && dea.serialNumber) {
    try { await applySerialTracking(dea.product, dea.serialNumber, clientName, userId) }
    catch (e) { console.error('Serial tracking (pose):', e.message) }
  }

  // Un DAE de plus sur un site sous contrat : le calendrier des contrôles suit.
  if (syncControls) {
    try { await syncSiteControls(site._id, userId) }
    catch (e) { console.error('Calendrier après pose :', e.message) }
  }
}

/**
 * Annule une pose qui n'a pas eu lieu : le DEA quitte le parc, mais
 * l'exemplaire reste réservé au client — on annule une date, pas la vente.
 * Sans effet sur un DEA déjà posé.
 */
async function cancelPose(site, dea, { userId } = {}) {
  if (!dea || dea.status !== 'a_installer') return false

  const items = await ProductItem.find({ dea: dea._id })
  for (const item of items) {
    const from = item.status
    item.dea  = undefined
    item.site = undefined
    if (item.status === 'reserve') {
      item.reservedFor = {
        client: site.client?._id || site.client, site: site._id,
        note: 'Pose annulée — réservation conservée',
      }
    }
    await logHistory(item, {
      action: 'Pose annulée — reste réservé', from, to: item.status, note: site.name, user: userId,
    })
  }

  dea.deleteOne()
  await site.save()
  return true
}

/**
 * Visite d'installation qui pose ces DEA (déjà enregistrés « à installer »
 * sur `site`). Un appareil ne dépend que d'une visite à venir : s'il figurait
 * sur une autre encore non démarrée, il la quitte — elle disparaît si elle
 * n'avait plus rien à poser.
 */
async function createPoseVisit({ site, client, deas, scheduledDate, technician, technicianName, notes, user }) {
  const ids = deas.map(d => d._id)
  const others = await Intervention.find({
    controlType: 'installation', status: 'planifie', targets: { $in: ids },
  })
  for (const v of others) {
    v.targets = (v.targets || []).filter(t => !ids.some(id => String(id) === String(t)))
    if (v.installation && ids.some(id => String(id) === String(v.installation))) v.installation = undefined
    if (!v.targets.length) { await v.deleteOne(); continue }
    v.history.push({
      action: 'modification', user: user?._id, userName: user?.fullName || user?.username,
      details: "Appareil reprogrammé sur une autre visite d'installation",
    })
    await v.save()
  }

  const first = deas[0]
  const n = deas.length
  const objet = n > 1
    ? `Pose de ${n} DAE`
    : `Pose du DAE ${[first.deviceType, first.serialNumber].filter(Boolean).join(' · ')}`.trim()
  return Intervention.create({
    client:     client?._id || client || site.client,
    clientName: client?.name || site.clientName || '',
    site:       site._id,
    siteName:   site.name,
    targets:    ids,
    installation: n === 1 ? first._id : undefined,
    installationSnap: n === 1 ? {
      deviceType: first.deviceType, serialNumber: first.serialNumber,
      address: [site.name, site.address?.street, site.address?.city].filter(Boolean).join(', '),
      location: first.location,
    } : undefined,
    technicien:     technician || undefined,
    technicienName: technicianName || undefined,
    scheduledDate,
    manualDate:     true,
    controlType:    'installation',
    objet,
    notes:          notes || undefined,
    status:         'planifie',
    // La nature du bon (installation, + formation si liée) se déduit de la visite.
    history: [{
      action: 'creation', user: user?._id, userName: user?.fullName || user?.username,
      details: `Installation programmée — ${objet}`,
    }],
    createdBy: user?._id,
  })
}

module.exports = { applySerialTracking, completePose, cancelPose, createPoseVisit }
