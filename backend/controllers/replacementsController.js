const mongoose    = require('mongoose')
const Replacement = require('../models/Replacement')
const ProductItem = require('../models/ProductItem')
const Site        = require('../models/Site')
const { syncProductStock, logHistory } = require('../utils/productItems')

const POPULATE = [
  { path: 'client',          select: 'name' },
  { path: 'site',            select: 'name address client' },
  { path: 'product',         select: 'name reference images category' },
  { path: 'faultyItem',      select: 'serialNumber lotNumber status product' },
  { path: 'replacementItem', select: 'serialNumber lotNumber status product' },
  { path: 'requestedBy',     select: 'fullName username' },
  { path: 'intervention',    select: 'scheduledDate controlType status' },
]

const ADMIN_ROLES = ['superadmin', 'admin']
/* Traiter une demande touche au stock : c'est le métier du magasin. */
function canTreat(user) {
  return ADMIN_ROLES.includes(user.role) || user.permissions?.canManageStock
}

function trace(doc, req, entry) {
  doc.history.push({
    ...entry,
    user:     req.user._id,
    userName: req.user.fullName || req.user.username,
    date:     new Date(),
  })
}

/** Étiquette lisible d'un DEA du parc, figée dans la demande. */
function deaLabelOf(dea) {
  if (!dea) return ''
  return [dea.deviceType, dea.serialNumber && `n° ${dea.serialNumber}`, dea.location]
    .filter(Boolean).join(' · ') || 'DAE'
}

/**
 * Retrouve l'article du stock désigné par le numéro saisi. Le technicien lit un
 * numéro sur l'appareil : il ne sait pas s'il correspond à une fiche de stock.
 */
async function findItemByNumber({ serialNumber, lotNumber, site }) {
  const sn  = String(serialNumber || '').trim()
  const lot = String(lotNumber || '').trim()
  if (!sn && !lot) return null

  const or = []
  if (sn)  or.push({ serialNumber: sn })
  if (lot) or.push({ lotNumber: lot })

  // Un lot peut être partagé entre plusieurs sites : celui du site prime.
  return (site && await ProductItem.findOne({ $or: or, site })) ||
         ProductItem.findOne({ $or: or })
}

/**
 * Réserve un article disponible du même modèle pour ce client.
 * Sans modèle identifié ou sans disponible, on ne réserve rien : la demande
 * reste valable, elle attend simplement du réapprovisionnement.
 */
async function reserveReplacement(replacement, req) {
  if (!replacement.product) return null

  const candidate = await ProductItem.findOne({
    product: replacement.product,
    status:  'disponible',
  }).sort({ expirationDate: 1, entryDate: 1 })   // le plus ancien / le plus proche de péremption d'abord
  if (!candidate) return null

  const from = candidate.status
  candidate.status = 'reserve'
  candidate.reservedFor = {
    client: replacement.client || undefined,
    note:   `Remplacement demandé — ${replacement.deaLabel || 'parc'}`,
  }
  await logHistory(candidate, {
    action: 'Réservé pour un remplacement',
    from, to: 'reserve', user: req.user._id,
  })
  return candidate
}

/* GET /api/replacements */
async function getAll(req, res) {
  const { status, site, client, kind, intervention } = req.query
  const filter = {}
  if (status) filter.status = { $in: String(status).split(',').map(s => s.trim()).filter(Boolean) }
  if (site)         filter.site         = site
  if (client)       filter.client       = client
  if (kind)         filter.kind         = kind
  if (intervention) filter.intervention = intervention

  const list = await Replacement.find(filter)
    .populate(POPULATE)
    .sort({ createdAt: -1 })
    .limit(500)

  const counts = await Replacement.aggregate([
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ])
  const summary = Object.fromEntries(counts.map(c => [c._id, c.n]))

  res.json({ data: list, total: list.length, summary })
}

/* GET /api/replacements/:id */
async function getById(req, res) {
  const doc = await Replacement.findById(req.params.id).populate(POPULATE)
  if (!doc) return res.status(404).json({ message: 'Demande introuvable.' })
  res.json(doc)
}

/**
 * POST /api/replacements
 * Ouverte à tout utilisateur authentifié : c'est le technicien sur le terrain
 * qui constate la panne.
 */
async function create(req, res) {
  const {
    site: siteId, dea: deaId, kind, status, reason,
    serialNumber, lotNumber, productName, product,
    replacementSerial, notes, intervention,
  } = req.body

  if (!Replacement.KINDS.includes(kind)) {
    return res.status(422).json({ message: 'Type d\'élément invalide.' })
  }
  const site = await Site.findById(siteId).select('name client deas')
  if (!site) return res.status(404).json({ message: 'Site introuvable.' })

  const dea = deaId ? site.deas.id(deaId) : null

  const doc = new Replacement({
    client:   site.client,
    site:     site._id,
    dea:      dea?._id,
    deaLabel: deaLabelOf(dea),
    kind,
    status:   Replacement.STATUSES.includes(status) ? status : 'a_remplacer',
    reason:   Replacement.REASONS.includes(reason) ? reason : 'defectueux',
    serialNumber, lotNumber, productName,
    notes,
    intervention: intervention || undefined,
    requestedBy:     req.user._id,
    requestedByName: req.user.fullName || req.user.username,
  })

  // Rattachement au stock : c'est lui qui permet de sortir la pièce défectueuse.
  const faulty = await findItemByNumber({ serialNumber, lotNumber, site: site._id })
  if (faulty) {
    doc.faultyItem = faulty._id
    doc.product    = faulty.product
  } else if (product && mongoose.isValidObjectId(product)) {
    doc.product = product
  }

  trace(doc, req, {
    action: doc.status === 'remplace' ? 'Remplacement consigné' : 'Remplacement demandé',
    to: doc.status, note: notes,
  })
  await doc.save()

  // La pièce défectueuse sort du stock : elle ne doit plus être proposée.
  if (faulty && faulty.status !== 'hs') {
    const from = faulty.status
    faulty.status = 'hs'
    faulty.reservedFor = undefined
    await logHistory(faulty, {
      action: 'Signalé hors service lors d\'un contrôle',
      from, to: 'hs', note: notes, user: req.user._id,
    })
    await syncProductStock(faulty.product)
  }

  if (doc.status === 'remplace') {
    await applyReplacement(doc, { replacementSerial }, req)
  } else {
    const reserved = await reserveReplacement(doc, req)
    if (reserved) {
      doc.replacementItem = reserved._id
      trace(doc, req, { action: 'Remplaçant réservé en stock', note: reserved.serialNumber || reserved.lotNumber })
      await doc.save()
      await syncProductStock(reserved.product)
    }
  }

  const saved = await Replacement.findById(doc._id).populate(POPULATE)
  res.status(201).json(saved)
}

/**
 * Solde une demande : la pièce posée quitte le stock et rejoint le site.
 * Le parc n'est pas réécrit ici — remplacer un DEA change son numéro de série,
 * ce qui se fait depuis la fiche du site en connaissance de cause.
 */
async function applyReplacement(doc, { replacementSerial }, req) {
  doc.status     = 'remplace'
  doc.replacedAt = new Date()
  if (replacementSerial) doc.replacementSerial = replacementSerial

  // Le numéro saisi désigne la pièce posée ; à défaut, celle qu'on avait réservée.
  let item = null
  if (replacementSerial) {
    item = await findItemByNumber({ serialNumber: replacementSerial, lotNumber: replacementSerial })
  }
  if (!item && doc.replacementItem) item = await ProductItem.findById(doc.replacementItem)

  if (item) {
    const from = item.status
    item.status      = 'installe'
    item.site        = doc.site
    item.client      = doc.client
    item.reservedFor = undefined
    if (doc.dea) item.dea = doc.dea
    await logHistory(item, {
      action: 'Posé en remplacement',
      from, to: 'installe', user: req.user._id,
    })
    await syncProductStock(item.product)
    doc.replacementItem   = item._id
    doc.replacementSerial = doc.replacementSerial || item.serialNumber || item.lotNumber
  }

  trace(doc, req, { action: 'Marqué remplacé', to: 'remplace', note: doc.replacementSerial })
  await doc.save()
  return doc
}

/* PATCH /api/replacements/:id — traitement d'une demande. */
async function update(req, res) {
  if (!canTreat(req.user)) {
    return res.status(403).json({ message: 'Seule la gestion du stock peut traiter une demande.' })
  }
  const doc = await Replacement.findById(req.params.id)
  if (!doc) return res.status(404).json({ message: 'Demande introuvable.' })

  const { status, replacementSerial, notes, reason } = req.body
  if (notes  !== undefined) doc.notes  = notes
  if (reason !== undefined && Replacement.REASONS.includes(reason)) doc.reason = reason

  if (status && status !== doc.status) {
    if (!Replacement.STATUSES.includes(status)) {
      return res.status(422).json({ message: 'Statut invalide.' })
    }
    if (status === 'remplace') {
      await applyReplacement(doc, { replacementSerial }, req)
    } else {
      // Annulation : le remplaçant réservé retourne au stock, il n'a pas servi.
      if (status === 'annule' && doc.replacementItem) {
        const item = await ProductItem.findById(doc.replacementItem)
        if (item && item.status === 'reserve') {
          const from = item.status
          item.status = 'disponible'
          item.reservedFor = undefined
          await logHistory(item, {
            action: 'Réservation levée (demande annulée)',
            from, to: 'disponible', user: req.user._id,
          })
          await syncProductStock(item.product)
        }
        doc.replacementItem = undefined
      }
      const from = doc.status
      doc.status = status
      trace(doc, req, { action: `${from} → ${status}`, from, to: status, note: notes })
      await doc.save()
    }
  } else {
    await doc.save()
  }

  const saved = await Replacement.findById(doc._id).populate(POPULATE)
  res.json(saved)
}

/* DELETE /api/replacements/:id */
async function remove(req, res) {
  if (!canTreat(req.user)) {
    return res.status(403).json({ message: 'Suppression réservée à la gestion du stock.' })
  }
  const doc = await Replacement.findById(req.params.id)
  if (!doc) return res.status(404).json({ message: 'Demande introuvable.' })

  // Une réservation encore ouverte ne doit pas rester bloquée derrière une
  // demande effacée.
  if (doc.status === 'a_remplacer' && doc.replacementItem) {
    const item = await ProductItem.findById(doc.replacementItem)
    if (item && item.status === 'reserve') {
      item.status = 'disponible'
      item.reservedFor = undefined
      await logHistory(item, {
        action: 'Réservation levée (demande supprimée)',
        from: 'reserve', to: 'disponible', user: req.user._id,
      })
      await syncProductStock(item.product)
    }
  }

  await doc.deleteOne()
  res.json({ message: 'Demande supprimée.' })
}

module.exports = { getAll, getById, create, update, remove }
