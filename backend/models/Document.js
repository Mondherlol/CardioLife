const mongoose = require('mongoose')

const permSchema = new mongoose.Schema({
  inherit:  { type: Boolean, default: true },
  isPublic: { type: Boolean, default: false },
  roles:    [{ type: String }],
  users:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { _id: false })

const documentSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  type:        { type: String, enum: ['folder', 'file'], required: true },
  parent:      { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  mimeType:    { type: String },
  size:        { type: Number, default: 0 },
  storageKey:  { type: String },
  permissions: { type: permSchema, default: () => ({}) },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isDeleted:   { type: Boolean, default: false },
  isSystem:    { type: Boolean, default: false },
  // Rôle d'un dossier système : 'rapports' pour « Rapports d'intervention »
  // et ses sous-dossiers par année, lus du plus récent au plus ancien.
  systemKind:  { type: String },
  // Rapport PDF d'une intervention : le fichier sait de quelle visite il vient.
  intervention: { type: mongoose.Schema.Types.ObjectId, ref: 'Intervention' },
  // Bon d'intervention d'une formation.
  formation:    { type: mongoose.Schema.Types.ObjectId, ref: 'Formation' },
  // 'rapport' | 'bon' : documents rangés automatiquement pour une visite.
  docKind:      { type: String },
  // …et de quel site : la fiche du site affiche ses rapports sans les déplacer.
  site:         { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
}, { timestamps: true })

documentSchema.index({ parent: 1, isDeleted: 1 })

module.exports = mongoose.model('Document', documentSchema)
