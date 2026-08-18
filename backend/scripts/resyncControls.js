/**
 * Reprise : recalcule le calendrier des visites de tous les contrats actifs.
 *
 * Les échéances étaient comptées depuis la signature du contrat. Elles partent
 * désormais de la **pose** des appareils : première visite six mois après
 * l'installation, la suivante à l'anniversaire (contrôle annuel), et ainsi de
 * suite en alternance.
 *
 * Les visites déjà réalisées ne sont pas touchées. Les visites planifiées qui
 * ne correspondent plus à une échéance sont remplacées. La date du prochain
 * contrôle de chaque DAE est réalignée sur la première visite à venir.
 *
 * Idempotent — relançable sans risque.
 *
 * `--drop-passees` retire en plus les visites planifiées **dans le passé** et
 * jamais honorées. Un parc repris longtemps après sa pose — une installation de
 * 2016 mise sous contrat aujourd'hui — s'en voyait attribuer d'office : elles
 * n'ont jamais eu lieu, personne ne les fera, et elles tiraient la date du
 * prochain contrôle vers une échéance déjà dépassée. Les visites commencées ou
 * terminées ne sont jamais touchées.
 *
 * Usage : node scripts/resyncControls.js [--dry] [--drop-passees]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Contract     = require('../models/Contract')
const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')
const { scheduleFor, scheduleAnchor, syncContractControls, syncSiteNextControl } = require('../utils/controls')

const DRY  = process.argv.includes('--dry')
const DROP = process.argv.includes('--drop-passees')
const fmt = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—')

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const contracts = await Contract.find({ isActive: true, status: 'actif', site: { $ne: null } })
  console.log(`${contracts.length} contrat(s) actif(s).\n`)

  let created = 0, removed = 0
  for (const contract of contracts) {
    const site = await Site.findById(contract.site).select('name deas')
    if (!site) { console.log(`? ${contract.contractNumber || contract._id} — site introuvable`); continue }

    const planned = scheduleFor(site, contract)
    console.log(`${contract.contractNumber || contract._id} — « ${site.name} »`)
    console.log(`   pose de référence : ${fmt(scheduleAnchor(site, contract))}`)
    planned.forEach(p => console.log(`   ${fmt(p.date)}  ${p.type}`))
    if (!planned.length) console.log('   (aucune échéance dans la période du contrat)')

    if (!DRY) {
      const r = await syncContractControls(contract, contract.createdBy)
      created += r.created
      removed += r.removed
      console.log(`   → ${r.created} créée(s), ${r.removed} remplacée(s)`)
    }
    console.log('')
  }

  if (DROP) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const query = {
      status: 'planifie',
      manualDate: { $ne: true },
      scheduledDate: { $lt: today, $ne: null },
      contract: { $ne: null },
    }
    const stale = await Intervention.find(query).select('site siteName scheduledDate controlType').lean()
    console.log(`
${stale.length} visite(s) planifiée(s) dans le passé et jamais honorée(s) :`)
    stale.forEach(iv => console.log(`   ${fmt(iv.scheduledDate)}  ${iv.controlType}  « ${iv.siteName || '?'} »`))

    if (!DRY && stale.length) {
      await Intervention.deleteMany(query)
      // Chaque site concerné retrouve une échéance à venir.
      const sites = [...new Set(stale.map(iv => String(iv.site)).filter(Boolean))]
      for (const id of sites) await syncSiteNextControl(id)
      console.log(`   → ${stale.length} retirée(s).`)
    }
  }

  if (!DRY) console.log(`Total : ${created} visite(s) créée(s), ${removed} remplacée(s).`)
  console.log(DRY ? 'Simulation terminée — relancez sans --dry pour écrire.' : 'Reprise terminée.')
  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
