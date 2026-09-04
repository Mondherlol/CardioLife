const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')
const { PASSWORD_MIN_LENGTH } = require('../config/auth')

const permissionsSchema = new mongoose.Schema({
  canManageClients:      { type: Boolean, default: false },
  canManageDevices:      { type: Boolean, default: false },
  canManageContracts:    { type: Boolean, default: false },
  canManageStock:        { type: Boolean, default: false },
  /* Consultation seule du catalogue et des articles.
     `default: true` volontaire : jusqu'ici les lectures du stock étaient
     ouvertes à tout compte connecté. Les comptes déjà en base n'ont pas la
     clé — mongoose applique donc ce défaut et rien ne casse. Le droit devient
     simplement révocable, et les comptes créés désormais reçoivent la valeur
     explicite du préréglage de leur rôle. */
  canViewStock:          { type: Boolean, default: true },
  canManageInterventions:{ type: Boolean, default: false },
  canManageUsers:        { type: Boolean, default: false },
  canViewReports:        { type: Boolean, default: false },
  canManageFormations:   { type: Boolean, default: false },
}, { _id: false })

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    minlength: PASSWORD_MIN_LENGTH,
    select: false,
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'technicien', 'commercial', 'assistante', 'readonly'],
    default: 'readonly',
  },
  permissions: {
    type: permissionsSchema,
    default: () => ({}),
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  avatar: { type: String, default: null },
  phones: { type: [String], default: [] },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true })

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  const salt = await bcrypt.genSalt(12)
  this.password = await bcrypt.hash(this.password, salt)
  next()
})

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password)
}

module.exports = mongoose.model('User', userSchema)
