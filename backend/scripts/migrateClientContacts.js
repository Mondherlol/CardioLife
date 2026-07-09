/**
 * Migre les clients de l'ancien format contact vers le nouveau :
 *   contact { name, phones[], emails[] }  →  contacts [{ name, phone, email }]
 *   internalManager (string)             →  internalManagers [{ name, phone, email }]
 *
 * Usage : node scripts/migrateClientContacts.js
 * Idempotent : les clients déjà migrés (champ `contacts` présent) sont ignorés.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose = require('mongoose')
const Client   = require('../models/Client')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('MongoDB connecté.')

  // Driver brut : les anciens champs ne sont plus dans le schéma mongoose.
  const coll   = Client.collection
  const cursor = coll.find({ contacts: { $exists: false } })

  let migrated = 0
  let skipped  = 0

  for await (const doc of cursor) {
    const old      = doc.contact || {}
    const phones   = (old.phones || []).filter(Boolean)
    const emails   = (old.emails || []).filter(Boolean)
    const contacts = []

    // Le contact principal récupère le nom + le 1er téléphone + le 1er email ;
    // les téléphones/emails supplémentaires deviennent des contacts sans nom.
    const maxLen = Math.max(phones.length, emails.length, old.name ? 1 : 0)
    for (let i = 0; i < maxLen; i++) {
      contacts.push({
        name:  i === 0 ? (old.name || '') : '',
        phone: phones[i] || '',
        email: emails[i] || '',
      })
    }

    const internalManagers = doc.internalManager
      ? [{ name: doc.internalManager, phone: '', email: '' }]
      : []

    await coll.updateOne(
      { _id: doc._id },
      {
        $set:   { contacts, internalManagers },
        $unset: { contact: '', internalManager: '' },
      }
    )

    if (contacts.length || internalManagers.length) migrated++
    else skipped++
  }

  console.log(`Migration terminée : ${migrated} client(s) migré(s), ${skipped} sans données de contact.`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
