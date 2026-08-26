/**
 * Reprise : reporte sur le parc les relevés des visites déjà clôturées.
 *
 * La remontée checklist → fiche client se fait désormais à la clôture. Les
 * visites clôturées avant elle ont laissé leurs relevés — péremptions, niveau
 * de batterie, n° de série, emplacement — dans le rapport, sans jamais les
 * porter sur le DAE. La fiche client affiche donc encore les valeurs de la
 * pose. Cette reprise fusionne les visites de chaque appareil, de la plus
 * ancienne à la plus récente, et porte le résultat sur le parc.
 *
 * Le planning n'est pas touché : rejouer la date de prochain passage d'une
 * visite de l'an dernier ramènerait le calendrier d'aujourd'hui à une échéance
 * déjà dépassée.
 *
 * Idempotent — relançable sans risque : une valeur déjà à jour ne produit
 * aucune écriture.
 *
 * La même reprise est disponible sans terminal, dans Paramètres › Dev Fix.
 * Elle partage cette implémentation : `utils/maintenance.js`.
 *
 * Usage : node scripts/resyncFiches.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const { resyncFiches } = require('../utils/maintenance')

const DRY = process.argv.includes('--dry')
const fmt = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—')

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const report = await resyncFiches({ dry: DRY })
  console.log(`${report.totals.visits} visite(s) clôturée(s) examinée(s).\n`)

  for (const s of report.sites) {
    console.log(`${DRY ? '·' : '✓'} ${s.site} · ${s.visits} visite(s), dernière le ${fmt(s.date)}`)
    s.changes.forEach(c => console.log(`    ${c}`))
  }

  console.log(
    `\n${report.totals.sites} site(s) mis à jour, `
    + `${report.totals.changes} valeur(s) reportée(s).`
    + (DRY ? '\nMode simulation : rien n\'a été écrit. Relancez sans --dry pour appliquer.' : '')
  )

  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
