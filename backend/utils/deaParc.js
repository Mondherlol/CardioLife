const mongoose = require('mongoose')
const Site = require('../models/Site')

/**
 * Le parc des DAE vit dans `Site.deas`. Ce module présente ces sous-documents
 * sous la forme historique des « installations » (`_id`, `clientName`,
 * `address`, `deviceType`…) attendue par les interventions, les contrôles, les
 * contrats, le planning et le tableau de bord.
 *
 * L'`_id` exposé est celui du DEA : c'est lui qui est stocké dans le champ
 * `installation` des autres collections.
 */

/* Adresse lisible d'un site : « Nom — rue, ville ». */
function siteAddress(site) {
  const parts = [site.address?.street, site.address?.city].filter(Boolean)
  return parts.length ? `${site.name} — ${parts.join(', ')}` : site.name
}

/** Un DEA au format « installation ». `site.client` peut être peuplé ou non. */
function toInstallation(site, dea) {
  const client = site.client && site.client._id ? site.client : null

  return {
    _id:        dea._id,
    site:       { _id: site._id, name: site.name, address: site.address, contacts: site.contacts },
    client:     client || site.client || null,
    clientName: client?.name || site.clientName || '',

    status:         dea.status || 'installe',
    scheduledDate:  dea.scheduledDate || null,
    technician:     dea.technician || null,
    technicianName: dea.technicianName || '',
    contract:       dea.contract || null,
    contractDate:   dea.contractDate || null,

    address:  siteAddress(site),
    location: dea.location || '',

    installationDate: dea.installationDate || null,
    nextControlDate:  dea.nextControlDate || null,
    controlType:      dea.controlType || '',

    deviceProduct: dea.product || null,
    deviceType:    dea.deviceType || '',
    serialNumber:  dea.serialNumber || '',

    batteries:  dea.batteries  || [],
    electrodes: dea.electrodes || [],

    notes:     dea.notes || '',
    createdAt: dea.createdAt,
    updatedAt: dea.updatedAt,
  }
}

/** Résout un DEA par son `_id`. Retourne `{ site, dea }` ou `null`. */
async function findDea(deaId) {
  if (!mongoose.isValidObjectId(deaId)) return null
  const site = await Site.findOne({ 'deas._id': deaId }).populate('client', 'name address underContract logo')
  if (!site) return null
  const dea = site.deas.id(deaId)
  return dea ? { site, dea } : null
}

/** Plusieurs DEA d'un coup, au format installation, indexés par id. */
async function mapDeas(deaIds) {
  const ids = [...new Set((deaIds || []).filter(Boolean).map(String))]
    .filter(id => mongoose.isValidObjectId(id))
  if (!ids.length) return {}

  const sites = await Site.find({ 'deas._id': { $in: ids } })
    .populate('client', 'name address underContract logo')

  const out = {}
  for (const site of sites) {
    for (const dea of site.deas) {
      if (ids.includes(String(dea._id))) out[String(dea._id)] = toInstallation(site, dea)
    }
  }
  return out
}

/**
 * Liste du parc au format installation.
 * filter : { client, status, contract, technician, from, to, search }
 */
async function listInstallations(filter = {}) {
  const siteQuery = { isActive: true }
  if (filter.client) siteQuery.client = filter.client

  const sites = await Site.find(siteQuery)
    .populate('client', 'name address underContract logo')
    .sort({ name: 1 })

  let rows = []
  for (const site of sites) {
    for (const dea of site.deas) rows.push(toInstallation(site, dea))
  }

  if (filter.status)     rows = rows.filter(r => r.status === filter.status)
  if (filter.contract)   rows = rows.filter(r => String(r.contract) === String(filter.contract))
  if (filter.technician) rows = rows.filter(r => String(r.technician) === String(filter.technician))

  // Plage de dates du planning : sur la date de pose planifiée.
  if (filter.from || filter.to) {
    const from = filter.from ? new Date(filter.from) : null
    const to   = filter.to   ? new Date(filter.to)   : null
    rows = rows.filter(r => {
      if (!r.scheduledDate) return false
      const d = new Date(r.scheduledDate)
      if (from && d < from) return false
      if (to   && d > to)   return false
      return true
    })
  }

  if (filter.search) {
    const q = String(filter.search).toLowerCase()
    rows = rows.filter(r =>
      r.clientName?.toLowerCase().includes(q) ||
      r.address?.toLowerCase().includes(q) ||
      r.location?.toLowerCase().includes(q) ||
      r.serialNumber?.toLowerCase().includes(q) ||
      r.deviceType?.toLowerCase().includes(q)
    )
  }

  rows.sort((a, b) =>
    (a.clientName || '').localeCompare(b.clientName || '', 'fr') ||
    (a.address || '').localeCompare(b.address || '', 'fr') ||
    (a.location || '').localeCompare(b.location || '', 'fr')
  )
  return rows
}

/** Nombre total de DAE posés (tableau de bord). */
function countDeas(match = {}) {
  return Site.aggregate([
    { $match: { isActive: true, ...match } },
    { $unwind: '$deas' },
    { $count: 'n' },
  ]).then(r => r[0]?.n || 0)
}

module.exports = { toInstallation, findDea, mapDeas, listInstallations, countDeas, siteAddress }
