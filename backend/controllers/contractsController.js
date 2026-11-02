const mongoose = require('mongoose')
const { validationResult } = require('express-validator')
const Contract     = require('../models/Contract')
const Client       = require('../models/Client')
const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')
const { listInstallations } = require('../utils/deaParc')
const { syncContractControls, syncSiteNextControl, addMonths } = require('../utils/controls')
const { pageParams, pageResult, searchRegex } = require('../utils/paging')
const {
  syncClientContractFlag, ensurePeriods, periodsOf, closeContract, settleContract,
} = require('../utils/contractRenewal')

const { STATUSES } = Contract

/* Deux mois avant un contrôle annuel, le prix du contrat augmente de 5 %. */
const ANNUAL_INCREASE_RATE   = 0.05
const INCREASE_WINDOW_MONTHS = 2

// Au millime près : le dinar compte trois décimales.
const roundPrice = n => Math.round(n * 1000) / 1000

/* Prix saisi : vide l'efface, sinon un montant positif (virgule acceptée). */
function parsePrice(v) {
  if (v === undefined) return { skip: true }
  if (v === null || v === '') return { value: undefined }
  const n = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return { error: 'Le prix du contrat doit être un montant positif.' }
  return { value: roundPrice(n) }
}

/**
 * Tarifs par DAE saisis : `[{ dea, price }]`. Une ligne sans montant est
 * ignorée, et seuls les DAE du site comptent — un appareil retiré du parc ne
 * se facture plus.
 */
function parseDeaPrices(v, site) {
  if (v === undefined) return { skip: true }
  if (!Array.isArray(v)) return { error: 'Tarifs par DAE invalides.' }
  const onSite = new Set((site?.deas || []).map(d => String(d._id)))
  const list = []
  for (const row of v) {
    if (!row || !onSite.has(String(row.dea))) continue
    const p = parsePrice(row.price)
    if (p.error) return { error: 'Le tarif de chaque DAE doit être un montant positif.' }
    if (p.value === undefined || p.skip) continue
    list.push({ dea: row.dea, price: p.value })
  }
  return { value: list }
}

const sumPrices = list => roundPrice(list.reduce((s, r) => s + r.price, 0))

/* Durée d'une période renouvelée, en mois. */
function parseMonths(v) {
  if (v === undefined || v === null || v === '') return { skip: true }
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n < 1 || n > 120) return { error: 'La durée de renouvellement doit être comprise entre 1 et 120 mois.' }
  return { value: n }
}

/* Montant facturé : une période offerte ne compte pas dans les totaux. */
const BILLED_PRICE = { $cond: [{ $eq: ['$freePeriod', true] }, 0, { $ifNull: ['$price', 0] }] }

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
  const [total, actifs, expirent, expires, [sum]] = await Promise.all([
    Contract.countDocuments({ isActive: true }),
    Contract.countDocuments({ isActive: true, status: 'actif' }),
    // Un contrat qui se renouvelle seul n'expire pas : seuls comptent ceux
    // sans renouvellement ou dont la résiliation est programmée.
    Contract.countDocuments({
      isActive: true, status: 'actif', endDate: { $gte: now, $lte: in30 },
      $or: [{ autoRenew: false }, { 'termination.date': { $ne: null } }],
    }),
    Contract.countDocuments({ isActive: true, status: 'actif', endDate: { $lt: now } }),
    // Montant de l'ensemble des contrats actifs, tous clients confondus.
    Contract.aggregate([
      { $match: { isActive: true, status: 'actif' } },
      { $group: { _id: null, amount: { $sum: BILLED_PRICE } } },
    ]),
  ])
  res.json({ total, actifs, expirent, expires, amount: roundPrice(sum?.amount || 0) })
}

/* ── Totaux par client ────────────────────────────────── */
/**
 * Contrats actifs regroupés par client : nombre de contrats, de DAE couverts
 * et montant cumulé. Le total général est la somme de ces lignes.
 */
async function getClientTotals(req, res) {
  const match = { isActive: true, status: 'actif' }
  const re = searchRegex(req.query.search)
  if (re) match.$or = [{ contractNumber: re }, { clientName: re }, { siteName: re }]

  const rows = await Contract.aggregate([
    { $match: match },
    { $group: {
      _id:        '$client',
      clientName: { $first: '$clientName' },
      contracts:  { $sum: 1 },
      unpriced:   { $sum: { $cond: [{ $eq: [{ $ifNull: ['$price', null] }, null] }, 1, 0] } },
      amount:     { $sum: BILLED_PRICE },
      sites:      { $push: '$site' },
    } },
    { $sort: { amount: -1, clientName: 1 } },
  ])

  const deaCounts = await deaCountsBySite(rows.flatMap(r => r.sites))
  const data = rows.map(({ sites, ...r }) => ({
    ...r,
    client: r._id,
    amount: roundPrice(r.amount),
    deaCount: sites.reduce((n, s) => n + (deaCounts[String(s)] || 0), 0),
  }))
  res.json({ data, amount: roundPrice(data.reduce((s, r) => s + r.amount, 0)) })
}

/* ── Liste ────────────────────────────────────────────── */
async function getAll(req, res) {
  const { search, status, type, client, site, archived = 'false' } = req.query
  const paging = pageParams(req.query)

  const filter = { isActive: archived === 'true' ? false : true }
  if (status) filter.status = status
  if (type)   filter.type   = type
  if (client) filter.client = client
  if (site)   filter.site   = site
  const re = searchRegex(search)
  if (re) filter.$or = [{ contractNumber: re }, { clientName: re }, { siteName: re }]

  // `_id` départage les contrats créés dans la même seconde (import du parc) :
  // sans lui, un lot chargé au défilement pourrait répéter ou sauter un contrat.
  const [total, data] = await Promise.all([
    Contract.countDocuments(filter),
    Contract.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate(POPULATE)
      .lean(),
  ])

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

  res.json(pageResult(rows, total, paging))
}

async function getById(req, res) {
  // Un contrat échu depuis le dernier passage du planificateur est réglé tout de suite.
  const due = await Contract.findById(req.params.id)
  if (!due) return res.status(404).json({ message: 'Contrat introuvable.' })
  if (due.isActive && due.status === 'actif') await settleContract(due)

  const contract = await Contract.findById(req.params.id)
    .populate([
      ...POPULATE,
      { path: 'periods.createdBy',        select: 'username fullName' },
      { path: 'priceIncreases.appliedBy', select: 'username fullName' },
      { path: 'termination.requestedBy',  select: 'username fullName' },
    ])
    .lean()
  contract.periods = periodsOf(contract)

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
  const price = parsePrice(b.price)
  if (price.error) return res.status(422).json({ message: price.error })

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

  const deaPrices = parseDeaPrices(b.deaPrices, site)
  if (deaPrices.error) return res.status(422).json({ message: deaPrices.error })
  const perDea = deaPrices.value || []

  // Un site n'a qu'un contrat en cours à la fois.
  const existing = await Contract.findOne({ site: site._id, isActive: true, status: 'actif' })
  if (existing) {
    return res.status(409).json({
      message: `Le site « ${site.name} » a déjà un contrat actif (${existing.contractNumber || 'sans numéro'}).`,
    })
  }

  const months = parseMonths(b.renewalMonths)
  if (months.error) return res.status(422).json({ message: months.error })

  // Un contrat court un an par défaut : la création ne demande que le numéro.
  const startDate = b.startDate ? new Date(b.startDate) : new Date()
  const endDate   = b.endDate ? new Date(b.endDate) : addMonths(startDate, months.value || 12)
  const contractPrice = perDea.length ? sumPrices(perDea) : price.value

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
    price:      contractPrice,
    deaPrices:  perDea,
    notes:      b.notes?.trim() || undefined,
    autoRenew:     b.autoRenew !== false,
    renewalMonths: months.value || 12,
    nextFree:      !!b.nextFree,
    freePeriod:    !!b.freePeriod,
    periods: [{
      start: startDate, end: endDate, price: contractPrice, free: !!b.freePeriod,
      kind: 'initial', createdBy: req.user._id,
    }],
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
  const price = parsePrice(b.price)
  if (price.error) return res.status(422).json({ message: price.error })

  const months = parseMonths(b.renewalMonths)
  if (months.error) return res.status(422).json({ message: months.error })

  // Les contrats antérieurs à l'historique reçoivent leur première période
  // avant modification : elle garde ainsi les valeurs d'origine.
  ensurePeriods(contract)

  const before = {
    start: contract.startDate?.getTime(),
    end:   contract.endDate?.getTime(),
    price: contract.price,
  }

  if (b.contractNumber !== undefined) contract.contractNumber = b.contractNumber?.trim() || undefined
  if (b.status && STATUSES.includes(b.status)) {
    // Un contrat remis en vigueur à la main oublie sa résiliation passée.
    if (b.status === 'actif' && contract.status !== 'actif') contract.termination = undefined
    contract.status = b.status
  }
  if (b.startDate !== undefined) contract.startDate = b.startDate || undefined
  if (b.endDate   !== undefined) contract.endDate   = b.endDate   || undefined
  if (b.notes     !== undefined) contract.notes     = b.notes?.trim() || undefined
  if (!price.skip) contract.price = price.value
  if (b.autoRenew  !== undefined) contract.autoRenew  = !!b.autoRenew
  if (b.nextFree   !== undefined) contract.nextFree   = !!b.nextFree
  if (b.freePeriod !== undefined) contract.freePeriod = !!b.freePeriod
  if (!months.skip) contract.renewalMonths = months.value

  if (b.deaPrices !== undefined) {
    const site = await Site.findById(contract.site).select('deas._id')
    const deaPrices = parseDeaPrices(b.deaPrices, site)
    if (deaPrices.error) return res.status(422).json({ message: deaPrices.error })
    contract.deaPrices = deaPrices.value
    // Des tarifs par DAE : le prix du contrat en est la somme.
    if (deaPrices.value.length) contract.price = sumPrices(deaPrices.value)
  }

  /* La saisie corrige la période en cours : ses bornes, son prix, sa gratuité.
     Le début n'appartient qu'à la première période — celui des suivantes est
     l'échéance de la précédente. */
  const current = contract.periods[contract.periods.length - 1]
  if (current) {
    if (contract.periods.length === 1 && contract.startDate) current.start = contract.startDate
    if (contract.endDate && !contract.termination?.date) current.end = contract.endDate
    if (contract.price !== before.price) current.price = contract.price
    current.free = !!contract.freePeriod
  }

  await contract.save()
  // Une échéance ramenée dans le passé est réglée sur-le-champ.
  if (contract.isActive && contract.status === 'actif') await settleContract(contract)

  // Un changement de période redécoupe les échéances : les visites encore à
  // venir sont réalignées, celles déjà réalisées sont conservées telles quelles.
  const datesChanged = before.start !== contract.startDate?.getTime()
                    || before.end   !== contract.endDate?.getTime()
  if (datesChanged) await syncContractControls(contract, req.user._id)

  await syncClientContractFlag(contract.client)

  const populated = await Contract.findById(contract._id).populate(POPULATE).lean()
  res.json(populated)
}

/* ── Hausses annuelles ────────────────────────────────── */
/**
 * Contrôles annuels des contrats actifs tombant d'ici deux mois : ce sont les
 * contrats dont le prix doit augmenter de 5 %. Une hausse déjà appliquée pour
 * ce contrôle est signalée avec les prix d'avant et d'après.
 */
async function getAnnualIncreases(req, res) {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = addMonths(from, INCREASE_WINDOW_MONTHS)
  to.setHours(23, 59, 59, 999)

  const controls = await Intervention.find({
    controlType:   'annuel',
    status:        { $ne: 'termine' },
    contract:      { $ne: null },
    scheduledDate: { $gte: from, $lte: to },
  })
    .sort({ scheduledDate: 1 })
    .select('contract scheduledDate clientName siteName')
    .lean()

  const contracts = await Contract.find({
    _id: { $in: controls.map(c => c.contract) },
    isActive: true,
    status: 'actif',
  })
    .select('contractNumber client clientName site siteName price priceIncreases')
    .lean()
  const byId = new Map(contracts.map(c => [String(c._id), c]))

  const data = controls.map(iv => {
    const c = byId.get(String(iv.contract))
    if (!c) return null
    const applied = (c.priceIncreases || []).find(p => String(p.control) === String(iv._id))
    const price   = applied ? applied.from : (c.price ?? null)
    return {
      control:        iv._id,
      scheduledDate:  iv.scheduledDate,
      contract:       c._id,
      contractNumber: c.contractNumber,
      client:         c.client,
      clientName:     c.clientName || iv.clientName,
      site:           c.site,
      siteName:       c.siteName || iv.siteName,
      price,
      newPrice:  applied ? applied.to : price != null ? roundPrice(price * (1 + ANNUAL_INCREASE_RATE)) : null,
      applied:   !!applied,
      appliedAt: applied?.appliedAt || null,
    }
  }).filter(Boolean)

  res.json({ rate: ANNUAL_INCREASE_RATE, months: INCREASE_WINDOW_MONTHS, data })
}

/** Applique la hausse de 5 % au prix du contrat, une fois par contrôle annuel. */
async function applyAnnualIncrease(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })

  const controlId = req.body.control
  const control = mongoose.isValidObjectId(controlId)
    ? await Intervention.findOne({ _id: controlId, contract: contract._id, controlType: 'annuel' }).select('_id')
    : null
  if (!control) return res.status(404).json({ message: 'Contrôle annuel introuvable pour ce contrat.' })

  if (contract.price == null) {
    return res.status(422).json({ message: "Renseignez d'abord le prix du contrat." })
  }
  if (contract.priceIncreases.some(p => String(p.control) === String(control._id))) {
    return res.status(409).json({ message: 'La hausse a déjà été appliquée pour ce contrôle annuel.' })
  }

  const from = contract.price
  let to = roundPrice(from * (1 + ANNUAL_INCREASE_RATE))
  // Tarifs par DAE : chacun augmente, le prix reste leur somme.
  if (contract.deaPrices?.length) {
    contract.deaPrices.forEach(r => { r.price = roundPrice(r.price * (1 + ANNUAL_INCREASE_RATE)) })
    to = sumPrices(contract.deaPrices)
  }
  contract.price = to
  contract.priceIncreases.push({
    control: control._id, from, to, rate: ANNUAL_INCREASE_RATE, appliedBy: req.user._id,
  })
  await contract.save()

  res.json({ price: to, from })
}

/* ── Résiliation ───────────────────────────────────────── */
/**
 * Le site sort du contrat, tout de suite ou à une date.
 *
 * Immédiate : le contrat passe « résilié » et les visites encore à faire
 * qu'il avait planifiées disparaissent du planning. Les visites réalisées ou
 * en cours restent, elles font partie de l'historique ; les interventions
 * ponctuelles aussi, elles ne viennent pas du calendrier.
 *
 * À date : le contrat court jusque-là (ses visites au-delà sont retirées),
 * puis passe « résilié » de lui-même. Une date postérieure à l'échéance
 * laisse les renouvellements se faire jusqu'à elle.
 */
async function terminate(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  if (contract.status === 'resilie') {
    return res.status(409).json({ message: 'Ce contrat est déjà résilié.' })
  }

  const reason = String(req.body?.reason || '').trim() || undefined
  const date   = req.body?.date ? new Date(req.body.date) : new Date()
  if (isNaN(date.getTime())) return res.status(422).json({ message: 'Date de résiliation invalide.' })
  // Fin de journée : le contrat couvre encore le jour indiqué.
  if (req.body?.date) date.setHours(23, 59, 59, 999)

  ensurePeriods(contract)
  contract.termination = { date, reason, requestedBy: req.user._id }

  if (date <= new Date()) {
    contract.termination.date = new Date()
    const removed = await closeContract(contract)
    return res.json({ message: 'Contrat résilié.', removedControls: removed })
  }

  if (contract.endDate && date < contract.endDate) contract.endDate = date
  await contract.save()
  await syncContractControls(contract, req.user._id)
  await syncClientContractFlag(contract.client)
  res.json({ message: 'Résiliation programmée.', scheduled: true, date })
}

/** Annule une résiliation programmée : la période en cours reprend sa fin. */
async function cancelTermination(req, res) {
  const contract = await Contract.findById(req.params.id)
  if (!contract) return res.status(404).json({ message: 'Contrat introuvable.' })
  if (contract.status !== 'actif' || !contract.termination?.date) {
    return res.status(409).json({ message: 'Aucune résiliation programmée sur ce contrat.' })
  }

  const current = contract.periods[contract.periods.length - 1]
  if (current?.end) contract.endDate = current.end
  contract.termination = undefined
  await contract.save()
  await settleContract(contract)
  await syncContractControls(contract, req.user._id)
  res.json({ message: 'Résiliation annulée.' })
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
  generateNumber, getStats, getClientTotals, getAll, getById,
  create, update, terminate, cancelTermination, archive, restore, permanentDelete,
  getAnnualIncreases, applyAnnualIncrease,
}
