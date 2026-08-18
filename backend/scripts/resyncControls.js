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
 * `--drop-passees` retire en plus les visites planifiées **dans le passé** et
 * jamais honorées. Un parc repris longtemps après sa pose — une installation de
 * 2016 mise sous contrat aujourd'hui — s'en voyait attribuer d'office : elles
 * n'ont jamais eu lieu, personne ne les fera, et elles tiraient la date du
 * prochain contrôle vers une échéance déjà dépassée. Les visites commencées ou
 * terminées ne sont jamais touchées.
 *
 * Idempotent — relançable sans risque.
 *
 * La même reprise est disponible sans terminal, dans Paramètres › Dev Fix.
 * Elle partage cette implémentation : `utils/maintenance.js`.
 *
 * Usage : node scripts/resyncControls.js [--dry] [--drop-passees]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const { resyncControls } = require('../utils/maintenance')

const DRY  = process.argv.includes('--dry')
const DROP = process.argv.includes('--drop-passees')
const fmt  = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—')

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const report = await resyncControls({ dry: DRY, dropPast: DROP })
  console.log(`${report.totals.contracts} contrat(s) actif(s).\n`)

  for (const c of report.contracts) {
    if (c.error) { console.log(`? ${c.number} — ${c.error}`); continue }

    console.log(`${c.number} — « ${c.site} »`)
    console.log(`   pose de référence : ${fmt(c.anchor)}`)
    c.planned.forEach(p => console.log(`   ${fmt(p.date)}  ${p.type}`))
    if (!c.planned.length) console.log('   (aucune échéance dans la période du contrat)')
    if (!DRY) {
      console.log(`   → ${c.created} créée(s), ${c.removed} remplacée(s)`)
      console.log(`   prochain contrôle affiché : ${fmt(c.nextControl)}`)
    }
    console.log('')
  }

  if (DROP) {
    console.log(`${report.totals.dropped} visite(s) planifiée(s) dans le passé et jamais honorée(s) :`)
    report.dropped.forEach(d => console.log(`   ${fmt(d.date)}  ${d.type}  « ${d.site} »`))
    if (!DRY && report.totals.dropped) console.log(`   → ${report.totals.dropped} retirée(s).`)
  }

  if (!DRY) {
    console.log(`\nTotal : ${report.totals.created} visite(s) créée(s), ${report.totals.removed} remplacée(s).`)
  }
  console.log(DRY ? 'Simulation terminée — relancez sans --dry pour écrire.' : 'Reprise terminée.')

  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
