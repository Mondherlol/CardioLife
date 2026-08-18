const Contract     = require('../models/Contract')
const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')
const { scheduleFor, scheduleAnchor, syncContractControls, syncSiteNextControl } = require('./controls')

/**
 * Opérations de reprise, appelables des deux côtés : en ligne de commande sur
 * le serveur, ou depuis les paramètres de l'application.
 *
 * Elles rendent un compte rendu structuré plutôt que d'écrire à l'écran — c'est
 * l'appelant qui décide de l'imprimer dans un terminal ou de l'afficher dans
 * une page. La logique, elle, n'existe qu'ici : deux copies finiraient par
 * diverger, et une reprise qui se comporte différemment selon d'où on la lance
 * ne vaut rien.
 *
 * Chacune accepte `dry` : on regarde d'abord, on écrit ensuite.
 */

/**
 * Réaligne le calendrier des visites de tous les contrats actifs, puis
 * l'échéance affichée sur chaque DAE.
 *
 * `dropPast` retire en plus les visites planifiées dans le passé et jamais
 * honorées : un parc repris longtemps après sa pose s'en voyait attribuer
 * d'office, et elles tirent la date du prochain contrôle vers une échéance
 * déjà dépassée. Les visites commencées, terminées, ou dont la date a été
 * fixée à la main ne sont jamais touchées.
 */
async function resyncControls({ dry = false, dropPast = false, userId = null } = {}) {
  const contracts = await Contract.find({ isActive: true, status: 'actif', site: { $ne: null } })

  const report = {
    task: 'resync-controls',
    dry,
    contracts: [],
    dropped:   [],
    totals:    { contracts: contracts.length, created: 0, removed: 0, dropped: 0 },
  }

  for (const contract of contracts) {
    const site = await Site.findById(contract.site).select('name deas')
    if (!site) {
      report.contracts.push({
        number: contract.contractNumber || String(contract._id),
        site:   null,
        error:  'Site introuvable',
      })
      continue
    }

    const planned = scheduleFor(site, contract)
    const entry = {
      number:  contract.contractNumber || String(contract._id),
      site:    site.name,
      anchor:  scheduleAnchor(site, contract),
      planned: planned.map(p => ({ date: p.date, type: p.type })),
      created: 0,
      removed: 0,
    }

    if (!dry) {
      const r = await syncContractControls(contract, userId || contract.createdBy)
      entry.created = r.created
      entry.removed = r.removed
      report.totals.created += r.created
      report.totals.removed += r.removed
    }

    // Après resync, l'échéance que la fiche client affichera pour ce site.
    entry.nextControl = site.deas?.length
      ? (await Site.findById(site._id).select('deas.nextControlDate').lean())
          ?.deas?.[0]?.nextControlDate || null
      : null

    report.contracts.push(entry)
  }

  if (dropPast) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const query = {
      status: 'planifie',
      manualDate: { $ne: true },
      scheduledDate: { $lt: today, $ne: null },
      contract: { $ne: null },
    }
    const stale = await Intervention.find(query)
      .select('site siteName scheduledDate controlType')
      .lean()

    report.dropped = stale.map(iv => ({
      site: iv.siteName || '?', date: iv.scheduledDate, type: iv.controlType,
    }))
    report.totals.dropped = stale.length

    if (!dry && stale.length) {
      await Intervention.deleteMany(query)
      // Chaque site concerné retrouve une échéance à venir.
      const sites = [...new Set(stale.map(iv => String(iv.site)).filter(Boolean))]
      for (const id of sites) await syncSiteNextControl(id)
    }
  }

  return report
}

/* Catalogue des reprises exposées à l'application. L'identifiant est ce que
   l'API reçoit : le reste décrit l'opération pour l'écran qui la propose. */
const TASKS = {
  'resync-controls': {
    label: 'Recalculer les échéances de contrôle',
    description:
      "Réaligne le calendrier des visites de chaque contrat actif sur la date de pose, "
      + "puis remet à jour la date du prochain contrôle affichée sur la fiche client. "
      + "À lancer quand une fiche annonce une échéance déjà passée.",
    detail:
      "Les visites terminées ne sont jamais touchées, ni les dates fixées à la main. "
      + "L'option « retirer les visites passées » supprime en plus les contrôles planifiés "
      + "avant aujourd'hui et jamais honorés.",
    options: [
      { id: 'dropPast', label: 'Retirer aussi les visites passées jamais honorées' },
    ],
    run: resyncControls,
  },
}

module.exports = { resyncControls, TASKS }
