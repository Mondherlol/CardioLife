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
 * Usage : node scripts/resyncControls.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Contract = require('../models/Contract')
const Site     = require('../models/Site')
const { scheduleFor, scheduleAnchor, syncContractControls } = require('../utils/controls')

const DRY = process.argv.includes('--dry')
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

  if (!DRY) console.log(`Total : ${created} visite(s) créée(s), ${removed} remplacée(s).`)
  console.log(DRY ? 'Simulation terminée — relancez sans --dry pour écrire.' : 'Reprise terminée.')
  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
