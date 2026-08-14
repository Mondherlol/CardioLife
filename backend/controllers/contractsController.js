const mongoose = require('mongoose')
const { validationResult } = require('express-validator')
const Contract     = require('../models/Contract')
const Client       = require('../models/Client')
const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')
const { listInstallations } = require('../utils/deaParc')
const { syncContractControls, syncSiteNextControl } = require('../utils/controls')

const { STATUSES } = Contract

/* Un client est « sous contrat » dès qu'un de ses sites l'est. Le drapeau est
   dénormalisé sur la fiche client : listes et tableau de bord le lisent
   directement. */
async function syncClientContractFlag(clientId) {
  if (!clientId) return
  const n = await Contract.countDocuments({ client: clientId, isActive: true, status: 'actif' })
  await Client.findByIdAndUpdate(clientId, { underContract: n > 0 })
}

/* Le calendrier des visites vit dans utils/controls : il dépend de la date de
   pose des appareils, pas seulement du contrat, et se recalcule aussi quand le
   parc du site change. */

const POPULATE = [
  { path: 'client', select: 'name type address' },
  { path: 'site',   select: 'name address' },
  { path: 'createdBy', select: 'username fullName' },
]

/* ── DAE couverts ──────────────────────────────────────────────
   Le contenu du contrat n'est pas saisi : ce sont les DAE installés sur le
   site, lus dans le parc au moment de l'affichage. */

async function deaCountsBySite(siteIds) {
  const ids = siteIds.filter(Boolean).map(id => new mongoose.Types.ObjectId(String(id)))
  if (!ids.length) return {}
  const rows = await Site.aggregate([
    { $match: { _id: { $in: ids } } },
    { $project: { n: { $size: { $ifNull: ['$deas', []] } } } },
  ])
  return Object.fromEntries(rows.map(r => [String(r._id), r.n]))
}

/* ── Génération du numéro de contrat ──────────────────── */
async function generateNumber(req, res) {
  const year  = new Date().getFullYear()
  const count = await Contract.countDocuments({
    createdAt: { $gte: new Date(`${year}-01-01`), $lt: new Date(`${year + 1}-01-01`) },
  })
  const number = `CT-${year}-${String(count + 1).padStart(4, '0')}`
  res.json({ number })
}

/* ── Statistiques ─────────────────────────────────────── */
async function getStats(req, res) {
  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const [total, actifs, expirent, expires] = await Promise.all([
    Contract.countDocuments({ isActive: true }),
    Contract.countDocuments({ isActive: true, status: 'actif' }),
    Contract.countDocuments({ isActive: true, status: 'actif', endDate: { $gte: now, $lte: in30 } }),
    Contract.countDocuments({ isActive: true, status: 'actif', endDate: { $lt: now } }),
  ])
  res.json({ total, actifs, expirent, expires })
}

/* ── Liste ────────────────────────────────────────────── */
async function getAll(req, res) {
  const { search, status, type, client, site, page = 1, limit = 20, archived = 'false' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  if (status) filter.status = status
  if (type)   filter.type   = type
  if (client) filter.client = client
  if (site)   filter.site   = site
  const q = search?.trim() || ''
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = { $regex: escaped, $options: 'i' }
    filter.$or = [{ contractNumber: re }, { clientName: re }, { siteName: re }]
  }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Contract.countDocuments(filter)
  const data  = await Contract.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .populate(POPULATE)
    .lean()

  // Prochain contrôle par contrat (contrôle non terminé le plus proche)
  const ids = data.map(c => c._id)
  const nextControls = await Intervention.aggregate([
    { $match: { contract: { $in: ids }, status: { $ne: 'termine' }, scheduledDate: { $ne: null } } },
    { $group: { _id: '$contract', next: { $min: '$scheduledDate' } } },
  ])
  const nextMap = Object.fromEntries(nextControls.map(n => [String(n._id), n.next]))
  const deaCounts = await deaCountsBySite(data.map(c => c.site?._id || c.site))

  const rows = data.map(c => ({
    ...c,
    nextControlDate: nextMap[String(c._id)] || null,
    deaCount: deaCounts[String(c.site?._id || c.site)] || 0,
  }))

  res.json({ data: rows, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) })
}

async function getById(req, res) {
  const contract = await Contract.findById(req.params.id).populate(POPULATE).lean()
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })

  // Contrôles liés à ce contrat (interventions générées / manuelles)
  const controls = await Intervention.find({ contract: contract._id })
    .sort({ scheduledDate: 1 })
    .select('clientName controlType status scheduledDate completedDate technicienName installationSnap')
    .populate('technicien', 'fullName username')
    .lean()

  // DAE couverts : le parc du site au moment de la consultation.
  const all  = await listInstallations({ client: contract.client?._id || contract.client })
  const sid  = String(contract.site?._id || contract.site || '')
  const installations = all.filter(i => String(i.site?._id || '') === sid)

  res.json({ ...contract, installations, controls })
}

/* ── Création ─────────────────────────────────────────── */
async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const b = req.body

  if (!b.site) return res.status(422).json({ message: 'Le site à couvrir est requis.' })

  const site = await Site.findById(b.site).select('name client deas')
  if (!site) return res.status(404).json({ message: 'Site introuvable.' })

  // Un contrat de maintenance porte sur du matériel : sans appareil posé, il
  // n'y a rien à contrôler et le calendrier des visites n'aurait pas d'objet.
  if (!site.deas?.length) {
    return res.status(422).json({
      message: `Aucun DAE sur le site « ${site.name} » : posez au moins un appareil avant de créer son contrat.`,
    })
  }

  const client = await Client.findById(site.client).select('name')
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })

  // Un site n'a qu'un contrat en cours à la fois.
  const existing = await Contract.findOne({ site: site._id, isActive: true, status: 'actif' })
  if (existing) {
    return res.status(409).json({
      message: `Le site « ${site.name} » a déjà un contrat actif (${existing.contractNumber || 'sans numéro'}).`,
    })
  }

  // Un contrat court un an par défaut : la création ne demande que le numéro.
  const startDate = b.startDate ? new Date(b.startDate) : new Date()
  const endDate   = b.endDate ? new Date(b.endDate) : (() => {
    const d = new Date(startDate)
    d.setFullYear(d.getFullYear() + 1)
    return d
  })()

  const contract = await Contract.create({
    contractNumber: b.contractNumber?.trim() || undefined,
    site:       site._id,
    siteName:   site.name,
    client:     client._id,
    clientName: client.name,
    type:       'maintenance',   // les contrats sont toujours de maintenance
    status:     STATUSES.includes(b.status) ? b.status : 'actif',
    startDate,
    endDate,
    notes:      b.notes?.trim() || undefined,
    createdBy:  req.user._id,
  })

  // Planifie les visites : tous les six mois depuis la pose, jusqu'à l'échéance
  await syncContractControls(contract, req.user._id)
  await syncClientContractFlag(contract.client)

  const populated = await Contract.findById(contract._id).populate(POPULATE).lean()
  res.status(201).json(populated)
}

/* ── Mise à jour ──────────────────────────────────────── */
async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })

  const b = req.body
  const before = {
    start: contract.startDate?.getTime(),
    end:   contract.endDate?.getTime(),
  }

  if (b.contractNumber !== undefined) contract.contractNumber = b.contractNumber?.trim() || undefined
  if (b.status && STATUSES.includes(b.status)) contract.status = b.status
  if (b.startDate !== undefined) contract.startDate = b.startDate || undefined
  if (b.endDate   !== undefined) contract.endDate   = b.endDate   || undefined
  if (b.notes     !== undefined) contract.notes     = b.notes?.trim() || undefined

  await contract.save()

  // Un changement de période redécoupe les échéances : les visites encore à
  // venir sont réalignées, celles déjà réalisées sont conservées telles quelles.
  const datesChanged = before.start !== contract.startDate?.getTime()
                    || before.end   !== contract.endDate?.getTime()
  if (datesChanged) await syncContractControls(contract, req.user._id)

  await syncClientContractFlag(contract.client)

  const populated = await Contract.findById(contract._id).populate(POPULATE).lean()
  res.json(populated)
}

/* ── Archivage / restauration / suppression ───────────── */
async function archive(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  contract.isActive = false
  await contract.save()
  await syncClientContractFlag(contract.client)
  await syncSiteNextControl(contract.site)
  res.json({ message: 'Contrat archivé.' })
}

async function restore(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  contract.isActive = true
  await contract.save()
  await syncClientContractFlag(contract.client)
  await syncContractControls(contract, req.user._id)
  res.json({ message: 'Contrat restauré.' })
}

async function permanentDelete(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  if (contract.isActive) {
    return res.status(400).json({ message: "Archivez d'abord le contrat avant de le supprimer définitivement." })
  }
  // On ne supprime pas les DAE : ils restent dans le parc du client.
  await contract.deleteOne()
  await syncClientContractFlag(contract.client)
  res.json({ message: 'Contrat supprimé définitivement.' })
}

module.exports = {
  generateNumber, getStats, getAll, getById,
  create, update, archive, restore, permanentDelete,
}
