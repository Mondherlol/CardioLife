/**
 * Reprise : réaligne `Client.underContract` sur les contrats réellement
 * enregistrés.
 *
 * Le statut contractuel était auparavant coché à la main sur la fiche du
 * client, indépendamment de l'existence d'un contrat. Il est maintenant
 * dérivé : un client est sous contrat s'il a au moins un contrat actif et non
 * archivé. Ce script met les anciennes fiches d'accord avec cette règle.
 *
 * Idempotent — relançable sans risque.
 *
 * Usage : node scripts/syncContractFlags.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Client   = require('../models/Client')
const Contract = require('../models/Contract')

const DRY = process.argv.includes('--dry')

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const clients = await Client.find({}).select('name underContract')
  const withContract = new Set(
    (await Contract.find({ isActive: true, status: 'actif' }).select('client').lean())
      .map(c => String(c.client))
  )

  let activated = 0, deactivated = 0
  for (const client of clients) {
    const should = withContract.has(String(client._id))
    if (!!client.underContract === should) continue

    console.log(`${should ? '+' : '-'} ${client.name} → ${should ? 'sous contrat' : 'hors contrat'}`)
    if (should) activated++; else deactivated++
    if (!DRY) await Client.updateOne({ _id: client._id }, { underContract: should })
  }

  console.log(`\n${clients.length} client(s) examiné(s) : ${activated} passé(s) sous contrat, ${deactivated} repassé(s) hors contrat.`)
  console.log(DRY ? 'Simulation terminée — relancez sans --dry pour écrire.' : 'Reprise terminée.')
  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
