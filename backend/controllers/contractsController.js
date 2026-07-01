const { validationResult } = require('express-validator')
const Contract     = require('../models/Contract')
const Installation = require('../models/Installation')
const Intervention = require('../models/Intervention')

const { TYPES, STATUSES } = Contract

/* Génère les contrôles périodiques du contrat, de startDate → endDate, sans
   technicien assigné (l'admin l'affectera plus tard). */
async function generateControls(contract, userId) {
  const { startDate, endDate, controlPeriodicity, client, clientName } = contract
  if (!startDate || !endDate || !['semestriel', 'annuel'].includes(controlPeriodicity)) return

  const interval = controlPeriodicity === 'annuel' ? 12 : 6
  const end = new Date(endDate)
  const d   = new Date(startDate)
  d.setHours(9, 0, 0, 0)                // heure par défaut des contrôles générés
  d.setMonth(d.getMonth() + interval)   // premier contrôle : début + période

  const docs = []
  let guard = 0
  while (d <= end && guard < 60) {
    docs.push({
      client:        client || undefined,
      clientName:    clientName || undefined,
      contract:      contract._id,
      controlType:   controlPeriodicity,
      scheduledDate: new Date(d),
      status:        'planifie',
      history: [{ action: 'creation', user: userId, details: 'Contrôle généré automatiquement par le contrat' }],
      createdBy:     userId,
    })
    d.setMonth(d.getMonth() + interval)
    guard++
  }
  if (docs.length) await Intervention.insertMany(docs)
}

/* ── Helpers ──────────────────────────────────────────── */

function computeEstimatedValue(lineItems = [], services = []) {
  const itemsTotal = lineItems.reduce((sum, it) =>
    sum + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 1), 0)
  const servicesTotal = services.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  return itemsTotal + servicesTotal
}

// Nettoie un brouillon d'installation reçu du frontend vers le schéma Installation.
function sanitizeInstallation(inst, clientId, clientName) {
  return {
    client:     clientId || inst.client || undefined,
    clientName: inst.clientName || clientName || '—',
    address:    (inst.address || '').trim() || '—',
    location:   (inst.location || '').trim() || undefined,
    installationDate: inst.installationDate || undefined,
    nextControlDate:  inst.nextControlDate  || undefined,
    controlType: inst.controlType || undefined,
    deviceProduct: inst.deviceProduct || undefined,
    deviceType:    inst.deviceType || undefined,
    serialNumber:  (inst.serialNumber || '').trim() || undefined,
    batteries: Array.isArray(inst.batteries) ? inst.batteries.map(b => ({
      product:        b.product || undefined,
      productName:    b.productName || undefined,
      expiryDate:     b.expiryDate || undefined,
      activationDate: b.activationDate || undefined,
      level:          b.level != null && b.level !== '' ? Number(b.level) : undefined,
      notes:          b.notes || undefined,
    })) : [],
    electrodes: Array.isArray(inst.electrodes) ? inst.electrodes.map(e => ({
      product:     e.product || undefined,
      productName: e.productName || undefined,
      expiryDate:  e.expiryDate || undefined,
      notes:       e.notes || undefined,
    })) : [],
    notes: inst.notes || undefined,
  }
}

function sanitizeLineItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter(it => it && (it.product || it.productName))
    .map(it => ({
      product:     it.product || undefined,
      productName: it.productName?.trim() || undefined,
      category:    it.category || undefined,
      quantity:    Math.max(1, Number(it.quantity) || 1),
      unitPrice:   Math.max(0, Number(it.unitPrice) || 0),
      fromPack:    it.fromPack || undefined,
    }))
}

function sanitizeServices(services) {
  return (Array.isArray(services) ? services : [])
    .filter(s => s && s.name?.trim())
    .map(s => ({
      name:     s.name.trim(),
      price:    Math.max(0, Number(s.price) || 0),
      fromPack: s.fromPack || undefined,
    }))
}

function sanitizePacks(packs) {
  return (Array.isArray(packs) ? packs : [])
    .filter(p => p && p.pack)
    .map(p => ({ pack: p.pack, name: p.name?.trim() || undefined }))
}

const POPULATE = [
  { path: 'client', select: 'name type address' },
  { path: 'installations', select: 'clientName address location deviceType serialNumber installationDate nextControlDate status scheduledDate technicianName' },
  { path: 'createdBy', select: 'username fullName' },
]

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
  const { search, status, type, client, page = 1, limit = 20, archived = 'false' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  if (status) filter.status = status
  if (type)   filter.type   = type
  if (client) filter.client = client
  const q = search?.trim() || ''
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = { $regex: escaped, $options: 'i' }
    filter.$or = [{ contractNumber: re }, { clientName: re }]
  }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Contract.countDocuments(filter)
  const data  = await Contract.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .populate(POPULATE)

  // Prochain contrôle par contrat (contrôle non terminé le plus proche)
  const ids = data.map(c => c._id)
  const nextControls = await Intervention.aggregate([
    { $match: { contract: { $in: ids }, status: { $ne: 'termine' }, scheduledDate: { $ne: null } } },
    { $group: { _id: '$contract', next: { $min: '$scheduledDate' } } },
  ])
  const nextMap = Object.fromEntries(nextControls.map(n => [String(n._id), n.next]))
  const withNext = data.map(c => ({ ...c.toObject(), nextControlDate: nextMap[String(c._id)] || null }))

  res.json({ data: withNext, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) })
}

async function getById(req, res) {
  const contract = await Contract.findById(req.params.id)
    .populate(POPULATE)
    .populate({ path: 'lineItems.product', select: 'name category reference images' })
    .populate({ path: 'packs.pack', select: 'name' })
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })

  // Contrôles liés à ce contrat (interventions générées / manuelles)
  const controls = await Intervention.find({ contract: contract._id })
    .sort({ scheduledDate: 1 })
    .select('clientName controlType status scheduledDate completedDate technicienName installationSnap')
    .populate('technicien', 'fullName username')
    .lean()

  res.json({ ...contract.toObject(), controls })
}

/* ── Création ─────────────────────────────────────────── */
async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const b = req.body

  // Les installations ne sont PAS créées automatiquement : elles se planifient
  // depuis la fiche du contrat (section « Installations couvertes »).
  const existing  = Array.isArray(b.existingInstallations) ? b.existingInstallations : []
  const lineItems = sanitizeLineItems(b.lineItems)
  const services  = sanitizeServices(b.services)

  const contract = await Contract.create({
    contractNumber: b.contractNumber?.trim() || undefined,
    client:     b.client,
    clientName: b.clientName?.trim() || undefined,
    type:       'maintenance',   // les contrats sont toujours de maintenance
    status:     STATUSES.includes(b.status) ? b.status : 'actif',
    startDate:  b.startDate || undefined,
    endDate:    b.endDate   || undefined,
    controlPeriodicity: ['semestriel', 'annuel'].includes(b.controlPeriodicity) ? b.controlPeriodicity : '',
    installations: existing,
    packs:      sanitizePacks(b.packs),
    lineItems,
    services,
    estimatedValue: computeEstimatedValue(lineItems, services),
    notes:      b.notes?.trim() || undefined,
    createdBy:  req.user._id,
  })

  // Génère les prochains contrôles jusqu'à l'échéance
  await generateControls(contract, req.user._id)

  const populated = await Contract.findById(contract._id).populate(POPULATE)
  res.status(201).json(populated)
}

/* ── Mise à jour ──────────────────────────────────────── */
async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })

  const b = req.body

  // Crée d'éventuelles nouvelles installations (packs/produits ajoutés à l'édition)
  const createdIds = []
  if (Array.isArray(b.newInstallations)) {
    for (const draft of b.newInstallations) {
      const created = await Installation.create({
        ...sanitizeInstallation(draft, b.client || contract.client, b.clientName || contract.clientName),
        createdBy: req.user._id,
      })
      createdIds.push(created._id)
    }
  }
  // `installations` = IDs existants conservés côté frontend
  const kept = Array.isArray(b.installations) ? b.installations : contract.installations

  if (b.contractNumber !== undefined) contract.contractNumber = b.contractNumber?.trim() || undefined
  if (b.client)     contract.client     = b.client
  if (b.clientName !== undefined) contract.clientName = b.clientName?.trim() || undefined
  if (b.type   && TYPES.includes(b.type))       contract.type   = b.type
  if (b.status && STATUSES.includes(b.status))  contract.status = b.status
  if (b.startDate !== undefined) contract.startDate = b.startDate || undefined
  if (b.endDate   !== undefined) contract.endDate   = b.endDate   || undefined
  if (b.controlPeriodicity !== undefined)
    contract.controlPeriodicity = ['semestriel', 'annuel'].includes(b.controlPeriodicity) ? b.controlPeriodicity : ''
  if (b.packs     !== undefined) contract.packs     = sanitizePacks(b.packs)
  if (b.lineItems !== undefined) contract.lineItems = sanitizeLineItems(b.lineItems)
  if (b.services  !== undefined) contract.services  = sanitizeServices(b.services)
  if (b.notes     !== undefined) contract.notes     = b.notes?.trim() || undefined

  contract.installations = [...kept, ...createdIds]
  contract.estimatedValue = computeEstimatedValue(contract.lineItems, contract.services)

  await contract.save()
  const populated = await Contract.findById(contract._id).populate(POPULATE)
  res.json(populated)
}

/* ── Archivage / restauration / suppression ───────────── */
async function archive(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  contract.isActive = false
  await contract.save()
  res.json({ message: 'Contrat archivé.' })
}

async function restore(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  contract.isActive = true
  await contract.save()
  res.json({ message: 'Contrat restauré.' })
}

async function permanentDelete(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  if (contract.isActive) {
    return res.status(400).json({ message: "Archivez d'abord le contrat avant de le supprimer définitivement." })
  }
  // On ne supprime pas les installations : elles restent dans le parc.
  await contract.deleteOne()
  res.json({ message: 'Contrat supprimé définitivement.' })
}

module.exports = {
  generateNumber, getStats, getAll, getById,
  create, update, archive, restore, permanentDelete,
}
