/**
 * Crée le premier utilisateur Super Admin.
 * Usage : node scripts/createSuperAdmin.js
 * À n'exécuter qu'une seule fois.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose = require('mongoose')
const User     = require('../models/User')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('MongoDB connecté.')

  const exists = await User.findOne({ role: 'superadmin' })
  if (exists) {
    console.log('Un Super Admin existe déjà :', exists.username)
    process.exit(0)
  }

  const admin = await User.create({
    username: 'admin',
    fullName: 'Super Admin CardioLife',
    email:    'admin@cardiolife.tn',
    password: 'admin',
    role:     'superadmin',
    permissions: {
      canManageClients:       true,
      canManageDevices:       true,
      canManageContracts:     true,
      canManageStock:         true,
      canManageInterventions: true,
      canManageUsers:         true,
      canViewReports:         true,
    },
  })

  console.log('Super Admin créé avec succès.')
  console.log('  username :', admin.username)
  console.log('  password : admin')
  console.log('Changez le mot de passe après la première connexion.')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
