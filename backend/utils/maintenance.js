const Contract     = require('../models/Contract')
const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')
const { scheduleFor, scheduleAnchor, syncContractControls, syncSiteNextControl } = require('./controls')
const { applyFicheToDea, resolveDea } = require('./ficheSync')
const ProductItem  = require('../models/ProductItem')
/* Chargé pour lui-même : `ProductItem.populate('product')` exige que le modèle
   soit enregistré, ce que les scripts — contrairement au serveur — ne font pas
   en démarrant. */
require('../models/Product')

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

/**
 * Reporte sur le parc les visites déjà clôturées.
 *
 * La remontée checklist → fiche client est née après coup : les visites
 * clôturées avant elle ont laissé leurs relevés dans le rapport sans jamais
 * les porter sur le DAE. Cette reprise les rattrape.
 *
 * Les visites ne sont pas rejouées une à une : elles sont d'abord **fusionnées
 * par appareil**, de la plus ancienne à la plus récente, en une fiche de
 * synthèse où la dernière valeur renseignée l'emporte. Rejouer chaque visite
 * dans l'ordre donnerait le même état final, mais réécrirait le parc à chaque
 * lancement — la reprise ne serait plus relançable sans bruit.
 *
 * Le planning n'est pas touché : rejouer la date de prochain passage d'une
 * visite de l'an dernier ramènerait le calendrier d'aujourd'hui à une échéance
 * déjà dépassée. Seules les données du parc remontent.
 */
async function resyncFiches({ dry = false, userId = null } = {}) {
  const visits = await Intervention
    .find({ status: 'termine', 'fiches.0': { $exists: true } })
    .sort({ completedDate: 1, updatedAt: 1 })

  const report = {
    task:   'resync-fiches',
    dry,
    sites:  [],
    totals: { visits: visits.length, sites: 0, changes: 0 },
  }

  /* Une visite d'avant les sites ne connaît que son appareil : le site se
     déduit alors du DAE. Sans ça, tout un pan du parc resterait au bord. */
  const bySite = new Map()
  for (const iv of visits) {
    let siteId = iv.site
    if (!siteId && iv.installation) {
      const owner = await Site.findOne({ 'deas._id': iv.installation }).select('_id').lean()
      siteId = owner?._id
    }
    if (!siteId) continue
    const key = String(siteId)
    if (!bySite.has(key)) bySite.set(key, [])
    bySite.get(key).push(iv)
  }

  for (const [siteId, siteVisits] of bySite) {
    const site = await Site.findById(siteId)
    if (!site) continue

    // Fiche de synthèse par appareil : la dernière valeur renseignée gagne.
    const merged = new Map()
    for (const iv of siteVisits) {
      for (const fiche of iv.fiches || []) {
        const dea = resolveDea(site, iv, fiche)
        if (!dea) continue
        const key  = String(dea._id)
        const acc  = merged.get(key) || { dea, fiche: {} }
        const obj  = fiche.toObject ? fiche.toObject() : fiche
        Object.entries(obj).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== '') acc.fiche[k] = v
        })
        acc.last = iv
        merged.set(key, acc)
      }
    }

    const changes = []
    for (const { dea, fiche } of merged.values()) applyFicheToDea(fiche, dea, changes)
    if (!changes.length) continue

    if (!dry) await site.save()

    report.sites.push({
      site:    site.name,
      visits:  siteVisits.length,
      date:    siteVisits[siteVisits.length - 1]?.completedDate || null,
      changes,
    })
    report.totals.sites   += 1
    report.totals.changes += changes.length
  }

  return report
}

/**
 * Éclate les lignes de stock qui portent plusieurs unités.
 *
 * La réception crée désormais une ligne par pièce : un lot de cinq batteries
 * tenu sur une seule ligne « × 5 » ne laissait suivre ni le statut ni
 * l'appareil de chacune. Les lignes reçues avant ce changement sont ici
 * découpées à l'identique — même lot, même DLC, même fournisseur, même date
 * d'entrée — et la première conserve son historique.
 *
 * Le total en stock ne bouge pas : cinq unités sur une ligne deviennent cinq
 * lignes d'une unité. Aucun mouvement de stock n'est écrit, rien n'entre ni ne
 * sort — c'est la même marchandise, présentée autrement.
 */
async function splitStockLots({ dry = false, userId = null } = {}) {
  const multi = await ProductItem.find({ quantity: { $gt: 1 } }).populate('product', 'name')

  const report = {
    task:   'split-stock-lots',
    dry,
    lines:  [],
    totals: { lines: multi.length, created: 0 },
  }

  for (const item of multi) {
    const before = item.quantity
    const extra  = before - 1

    if (!dry) {
      const copy = item.toObject()
      delete copy._id
      delete copy.createdAt
      delete copy.updatedAt
      // L'historique reste sur la ligne d'origine : le dupliquer ferait croire
      // à autant d'entrées en stock qu'il y a de pièces.
      copy.history  = [{
        action: 'Ligne de lot éclatée en unités',
        to:     item.status,
        user:   userId || undefined,
        date:   new Date(),
      }]
      copy.quantity = 1

      await ProductItem.insertMany(Array.from({ length: extra }, () => ({ ...copy })))

      item.quantity = 1
      item.history.push({
        action: 'Ligne de lot éclatée en unités',
        to:     item.status,
        note:   `${extra} ligne(s) créée(s)`,
        user:   userId || undefined,
        date:   new Date(),
      })
      await item.save()
    }

    report.lines.push({
      product:   item.product?.name || '—',
      lotNumber: item.lotNumber || item.serialNumber || '—',
      before,
      created:   extra,
    })
    report.totals.created += extra
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

  'resync-fiches': {
    label: 'Reporter les checklists sur les fiches clients',
    description:
      "Rejoue les visites déjà clôturées sur le parc : péremptions, niveau de batterie, "
      + "n° de série et emplacement relevés par le technicien remontent sur le DAE de la "
      + "fiche client. À lancer une fois, pour rattraper les visites d'avant la synchronisation.",
    detail:
      "Les visites sont rejouées de la plus ancienne à la plus récente : le dernier passage "
      + "a le dernier mot. Un champ laissé vide dans une checklist n'efface jamais la valeur "
      + "du parc. Le planning n'est pas touché — les dates de prochain contrôle des anciennes "
      + "visites ne sont pas rejouées.",
    options: [],
    run: resyncFiches,
  },

  'split-stock-lots': {
    label: 'Éclater les lots en lignes unitaires',
    description:
      "Découpe les lignes de stock qui portent plusieurs unités en une ligne par pièce, "
      + "comme le fait désormais la réception. À lancer une fois, pour les articles reçus "
      + "avant ce changement.",
    detail:
      "Le total en stock ne bouge pas : cinq unités sur une ligne deviennent cinq lignes "
      + "d'une unité, avec le même lot, la même DLC et le même fournisseur. Aucun mouvement "
      + "de stock n'est écrit. L'historique reste sur la ligne d'origine.",
    options: [],
    run: splitStockLots,
  },
}

module.exports = { resyncControls, resyncFiches, splitStockLots, TASKS }
