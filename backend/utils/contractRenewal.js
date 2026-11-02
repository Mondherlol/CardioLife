const Contract     = require('../models/Contract')
const Client       = require('../models/Client')
const Intervention = require('../models/Intervention')
const { syncContractControls, syncSiteNextControl, addMonths } = require('./controls')

/**
 * Cycle de vie d'un contrat dans le temps : périodes, renouvellement
 * automatique, résiliation à date.
 *
 * `startDate` reste le début du contrat d'origine ; `endDate` est la fin de la
 * période en cours — ou la date de résiliation si elle tombe avant. Le
 * calendrier des visites (utils/controls) ne lit que ces deux bornes : prolonger
 * `endDate` suffit à planifier les visites de la nouvelle période.
 */

// Garde-fou : un contrat oublié des années ne se renouvelle pas à l'infini.
const MAX_CATCH_UP = 50

/* Un client est « sous contrat » dès qu'un de ses sites l'est. Le drapeau est
   dénormalisé sur la fiche client : listes et tableau de bord le lisent
   directement. */
async function syncClientContractFlag(clientId) {
  if (!clientId) return
  const n = await Contract.countDocuments({ client: clientId, isActive: true, status: 'actif' })
  await Client.findByIdAndUpdate(clientId, { underContract: n > 0 })
}

/**
 * Les contrats antérieurs à l'historique n'ont pas de période : la première se
 * déduit de leurs dates et de leur prix. Sans dates, il n'y a rien à noter.
 */
function ensurePeriods(contract) {
  if (contract.periods?.length || !contract.startDate || !contract.endDate) return
  contract.periods.push({
    start: contract.startDate,
    end:   contract.endDate,
    price: contract.price,
    free:  !!contract.freePeriod,
    kind:  'initial',
    createdAt: contract.createdAt || new Date(),
    createdBy: contract.createdBy,
  })
}

/** Périodes à afficher, y compris celle déduite d'un contrat ancien (lecture seule). */
function periodsOf(contract) {
  if (contract.periods?.length) return contract.periods
  if (!contract.startDate || !contract.endDate) return []
  return [{
    start: contract.startDate, end: contract.endDate, price: contract.price,
    free: !!contract.freePeriod, kind: 'initial',
    createdAt: contract.createdAt, createdBy: contract.createdBy,
  }]
}

/**
 * Ouvre la période suivante : même durée, prix courant, offerte si demandé.
 * Une résiliation programmée borne la nouvelle période.
 */
function openNextPeriod(contract, { auto, userId }) {
  ensurePeriods(contract)
  const start = new Date(contract.endDate)
  let end = addMonths(start, contract.renewalMonths || 12)
  const stop = contract.termination?.date
  if (stop && new Date(stop) <= start) return false   // résilié avant : rien à ouvrir
  if (stop && new Date(stop) < end) end = new Date(stop)

  const free = !!contract.nextFree
  contract.periods.push({
    start, end, price: contract.price, free,
    kind: 'renouvellement', auto, createdBy: userId,
  })
  contract.endDate    = end
  contract.freePeriod = free
  contract.nextFree   = false
  return true
}

/** Retire du planning les visites encore à faire générées par le contrat. */
async function dropPlannedControls(contract) {
  const { deletedCount } = await Intervention.deleteMany({
    contract:    contract._id,
    status:      'planifie',
    controlType: { $ne: 'intervention' },
  })
  return deletedCount
}

/** Le contrat sort : statut « résilié », visites à venir retirées. */
async function closeContract(contract) {
  contract.status = 'resilie'
  await contract.save()
  const removed = await dropPlannedControls(contract)
  await syncClientContractFlag(contract.client)
  await syncSiteNextControl(contract.site)
  return removed
}

/**
 * Règle le sort d'un contrat arrivé à échéance :
 *  - résiliation dont la date est passée → résilié ;
 *  - renouvellement automatique → nouvelles périodes jusqu'à aujourd'hui ;
 *  - sinon → expiré.
 */
async function settleContract(contract, now = new Date()) {
  const stop = contract.termination?.date
  if (stop && new Date(stop) <= now) {
    await closeContract(contract)
    return 'resilie'
  }
  if (!contract.endDate || new Date(contract.endDate) > now) return null

  if (contract.autoRenew !== false) {
    let n = 0
    while (new Date(contract.endDate) <= now && n < MAX_CATCH_UP) {
      if (!openNextPeriod(contract, { auto: true, userId: null })) break
      n++
    }
    await contract.save()
    await syncContractControls(contract, contract.createdBy)
    return 'renouvele'
  }

  contract.status = 'expire'
  await contract.save()
  await syncClientContractFlag(contract.client)
  await syncSiteNextControl(contract.site)
  return 'expire'
}

/** Passe sur tous les contrats actifs échus ou dont la résiliation est due. */
async function renewDueContracts(now = new Date()) {
  const due = await Contract.find({
    isActive: true,
    status:   'actif',
    $or: [{ endDate: { $lte: now } }, { 'termination.date': { $lte: now } }],
  })
  const counts = { renouvele: 0, expire: 0, resilie: 0 }
  for (const contract of due) {
    try {
      const outcome = await settleContract(contract, now)
      if (outcome) counts[outcome]++
    } catch (err) {
      console.error(`Échéance du contrat ${contract.contractNumber || contract._id} :`, err.message)
    }
  }
  return counts
}

const SIX_HOURS = 6 * 60 * 60 * 1000

/** Vérification au démarrage puis toutes les six heures. */
function startRenewalScheduler() {
  const run = () => renewDueContracts()
    .then(c => {
      if (c.renouvele || c.expire || c.resilie) {
        console.log(`Contrats : ${c.renouvele} renouvelé(s), ${c.expire} expiré(s), ${c.resilie} résilié(s).`)
      }
    })
    .catch(err => console.error('Renouvellement des contrats :', err.message))
  setTimeout(run, 15 * 1000)
  setInterval(run, SIX_HOURS).unref()
}

module.exports = {
  syncClientContractFlag, ensurePeriods, periodsOf, openNextPeriod,
  dropPlannedControls, closeContract, settleContract, renewDueContracts,
  startRenewalScheduler,
}
