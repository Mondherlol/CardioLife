/**
 * Migre les rendez-vous de type « formation » de la collection Appointment
 * vers la collection Formation (source de vérité unique des formations).
 *
 *   Appointment { type:'formation', start, end, ... }  →  Formation { date:start, end, ... }
 *   puis l'Appointment d'origine est supprimé.
 *
 * Usage : node scripts/migrateFormationAppointments.js
 * Idempotent : les appointments migrés sont supprimés, donc relancer ne re-migre rien.
 * Les rendez-vous sans client sont ignorés (client requis sur Formation).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose    = require('mongoose')
const Appointment = require('../models/Appointment')
const Formation   = require('../models/Formation')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('MongoDB connecté.')

  const appts = await Appointment.find({ type: 'formation' }).lean()
  console.log(`${appts.length} rendez-vous de type formation à migrer.`)

  let migrated = 0
  let skipped  = 0

  for (const a of appts) {
    if (!a.client) {
      // Formation exige un client — impossible de migrer proprement.
      console.warn(`  ⚠ ignoré (aucun client) : ${a.title} [${a._id}]`)
      skipped++
      continue
    }

    await Formation.create({
      client:      a.client,
      clientName:  a.clientName,
      title:       a.title,
      date:        a.start,
      end:         a.end,
      status:      a.status || 'planifie',
      assignedTo:  a.assignedTo || [],
      description: a.description,
      documents:   [],
      history:     [{ action: 'Migrée depuis le planning', by: a.createdBy, at: new Date() }],
      createdBy:   a.createdBy,
      createdAt:   a.createdAt,
    })

    await Appointment.deleteOne({ _id: a._id })
    migrated++
  }

  console.log(`Migration terminée : ${migrated} formation(s) migrée(s), ${skipped} ignorée(s).`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
