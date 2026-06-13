const mongoose   = require('mongoose')
const ClientType = require('../models/ClientType')

const DEFAULT_TYPES = [
  { name: 'Hôtel',             slug: 'hotel' },
  { name: 'Usine',             slug: 'usine' },
  { name: 'École',             slug: 'ecole' },
  { name: 'Centre commercial', slug: 'centre_commercial' },
  { name: 'Administration',    slug: 'administration' },
  { name: 'Clinique',          slug: 'clinique' },
  { name: 'Autre',             slug: 'autre' },
]

async function seedClientTypes() {
  for (const t of DEFAULT_TYPES) {
    await ClientType.findOneAndUpdate(
      { slug: t.slug },
      { $setOnInsert: t },
      { upsert: true }
    )
  }
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('MongoDB connecté.')
    await seedClientTypes()
  } catch (err) {
    console.error('Erreur connexion MongoDB :', err.message)
    process.exit(1)
  }
}

module.exports = connectDB
