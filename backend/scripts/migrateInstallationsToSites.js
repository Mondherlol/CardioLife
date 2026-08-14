/**
 * Migration : collection `installations` → DEA embarqués dans `sites.deas`.
 *
 * Pour chaque installation on retrouve (ou crée) le site du client correspondant
 * à son adresse, on y pousse un DEA équivalent, puis on réécrit les références
 * `installation` / `installations` des autres collections vers le nouvel _id.
 *
 * Idempotent : une installation déjà migrée (marquée `migratedTo`) est ignorée.
 * La collection source n'est PAS supprimée — vérifiez le résultat, puis :
 *   db.installations.drop()
 *
 * Usage : node scripts/migrateInstallationsToSites.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Site         = require('../models/Site')
const Client       = require('../models/Client')
const Intervention = require('../models/Intervention')
const Control      = require('../models/Control')
const Contract     = require('../models/Contract')
const Appointment  = require('../models/Appointment')

const DRY = process.argv.includes('--dry')

/* La collection source n'a plus de modèle : on l'attaque en direct. */
function installationsCollection() {
  return mongoose.connection.collection('installations')
}

/* Nom de site déduit de l'adresse libre de l'installation. */
function siteNameFor(inst, client) {
  const addr = (inst.address || '').trim()
  if (!addr || addr === '—') return client?.name || inst.clientName || 'Site principal'
  // « Nom — rue, ville » : on ne garde que la partie avant le tiret cadratin.
  return addr.split('—')[0].trim() || addr
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) throw new Error('MONGO_URI manquant dans .env')
  await mongoose.connect(uri)
  console.log(`Connecté${DRY ? ' (simulation, aucune écriture)' : ''}.`)

  const col   = installationsCollection()
  const insts = await col.find({ migratedTo: { $exists: false } }).toArray()
  console.log(`${insts.length} installation(s) à migrer.`)

  const idMap = new Map()   // ancien _id installation → nouvel _id DEA
  let created = 0, sitesCreated = 0, skipped = 0

  for (const inst of insts) {
    if (!inst.client) {
      console.warn(`  ⨯ ${inst._id} : sans client, ignorée.`)
      skipped++
      continue
    }

    const client = await Client.findById(inst.client).select('name address').lean()
    if (!client) {
      console.warn(`  ⨯ ${inst._id} : client ${inst.client} introuvable, ignorée.`)
      skipped++
      continue
    }

    const wanted = siteNameFor(inst, client)
    let site = await Site.findOne({
      client: inst.client,
      name:   new RegExp(`^${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })

    if (!site) {
      if (DRY) {
        console.log(`  + site « ${wanted} » (${client.name})`)
        sitesCreated++
        continue
      }
      site = await Site.create({
        client:  inst.client,
        name:    wanted,
        address: { street: client.address?.street, city: client.address?.city },
        createdBy: inst.createdBy,
      })
      sitesCreated++
    }

    const dea = {
      product:      inst.deviceProduct || undefined,
      deviceType:   inst.deviceType || undefined,
      serialNumber: inst.serialNumber || undefined,
      location:     inst.location || undefined,

      status:         inst.status || 'installe',
      scheduledDate:  inst.scheduledDate || undefined,
      technician:     inst.technician || undefined,
      technicianName: inst.technicianName || undefined,
      contract:       inst.contract || undefined,
      contractDate:   inst.contractDate || undefined,
      controlType:    ['semestriel', 'annuel'].includes(inst.controlType) ? inst.controlType : '',

      installationDate: inst.installationDate || undefined,
      nextControlDate:  inst.nextControlDate || undefined,

      batteries:  inst.batteries  || [],
      electrodes: inst.electrodes || [],
      notes:      inst.notes || undefined,
    }

    if (DRY) {
      console.log(`  + DEA ${dea.deviceType || '?'} ${dea.serialNumber || ''} → ${site.name}`)
      created++
      continue
    }

    site.deas.push(dea)
    await site.save()
    const newId = site.deas[site.deas.length - 1]._id
    idMap.set(String(inst._id), newId)

    await col.updateOne({ _id: inst._id }, { $set: { migratedTo: newId, migratedAt: new Date() } })
    created++
  }

  console.log(`\n${created} DEA créé(s), ${sitesCreated} site(s) créé(s), ${skipped} ignorée(s).`)

  if (DRY) {
    console.log('Simulation terminée — aucune référence réécrite.')
    await mongoose.disconnect()
    return
  }

  // ── Réécriture des références ──────────────────────────
  let refs = 0
  for (const [oldId, newId] of idMap) {
    const r1 = await Intervention.updateMany({ installation: oldId }, { $set: { installation: newId } })
    const r2 = await Control.updateMany({ installation: oldId },      { $set: { installation: newId } })
    const r3 = await Appointment.updateMany({ installation: oldId },  { $set: { installation: newId } })
    const r4 = await Contract.updateMany({ installations: oldId },    { $set: { 'installations.$': newId } })
    refs += r1.modifiedCount + r2.modifiedCount + r3.modifiedCount + r4.modifiedCount
  }
  console.log(`${refs} référence(s) réécrite(s) dans interventions / contrôles / rendez-vous / contrats.`)

  console.log('\nVérifiez l\'application, puis supprimez la collection source :')
  console.log('  db.installations.drop()')

  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
