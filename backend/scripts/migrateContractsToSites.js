/**
 * Reprise : rattache les contrats existants à un site.
 *
 * Les contrats portaient sur le client. Ils portent désormais sur un site,
 * puisqu'un client peut avoir plusieurs sites, chacun avec son parc et son
 * propre calendrier de visites.
 *
 * Règle de reprise : un contrat est rattaché automatiquement lorsque son client
 * n'a qu'un seul site. Quand il y en a plusieurs, le choix appartient au
 * gestionnaire : ces contrats sont listés en fin d'exécution et doivent être
 * repris à la main (ouvrez le contrat, notez sa période, recréez-le depuis le
 * bon site, puis archivez l'ancien).
 *
 * Les contrôles déjà générés par un contrat repris reçoivent le même site, pour
 * apparaître dans l'historique de sa fiche.
 *
 * Idempotent — les contrats déjà rattachés sont ignorés.
 *
 * Usage : node scripts/migrateContractsToSites.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Contract     = require('../models/Contract')
const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')

const DRY = process.argv.includes('--dry')

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const orphans = await Contract.find({ site: { $in: [null, undefined] } }).lean()
  console.log(`${orphans.length} contrat(s) sans site.\n`)

  let attached = 0
  const ambiguous = []
  const clientless = []

  for (const contract of orphans) {
    const label = contract.contractNumber || String(contract._id)

    if (!contract.client) { clientless.push(label); continue }

    const sites = await Site.find({ client: contract.client, isActive: true })
      .select('name deas')
      .sort({ name: 1 })

    if (sites.length === 0) {
      clientless.push(`${label} (${contract.clientName || 'client inconnu'} — aucun site)`)
      continue
    }
    if (sites.length > 1) {
      ambiguous.push(`${label} (${contract.clientName || '—'}) → ${sites.length} sites : ${sites.map(s => s.name).join(', ')}`)
      continue
    }

    const site = sites[0]
    console.log(`+ ${label} → « ${site.name} » (${site.deas?.length || 0} DAE)`)
    attached++

    if (!DRY) {
      await Contract.updateOne({ _id: contract._id }, { site: site._id, siteName: site.name })
      // Les visites générées par ce contrat concernent ce site.
      await Intervention.updateMany(
        { contract: contract._id },
        { site: site._id, siteName: site.name },
      )
    }
  }

  console.log(`\n${attached} contrat(s) rattaché(s) automatiquement.`)

  if (ambiguous.length) {
    console.log(`\n⚠ ${ambiguous.length} contrat(s) à reprendre à la main (client multi-sites) :`)
    ambiguous.forEach(l => console.log(`   ${l}`))
  }
  if (clientless.length) {
    console.log(`\n⚠ ${clientless.length} contrat(s) sans site exploitable :`)
    clientless.forEach(l => console.log(`   ${l}`))
  }

  console.log(DRY ? '\nSimulation terminée — relancez sans --dry pour écrire.' : '\nReprise terminée.')
  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
