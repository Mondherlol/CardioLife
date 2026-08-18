const mongoose = require('mongoose')

/* Responsable du site. Un site peut en avoir plusieurs — le premier est
   considéré comme le responsable principal (celui affiché dans le tableau). */
const contactSchema = new mongoose.Schema({
  name:  { type: String, trim: true },
  role:  { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
}, { _id: false })

const electrodeSchema = new mongoose.Schema({
  product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String, trim: true },
  kind:        { type: String, enum: ['adulte', 'enfant', ''], default: '' },
  lotNumber:   { type: String, trim: true },
  expiryDate:  Date,
  notes:       { type: String, trim: true },
})

const batterySchema = new mongoose.Schema({
  product:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName:    { type: String, trim: true },
  serialNumber:   { type: String, trim: true },
  activationDate: Date,
  expiryDate:     Date,
  level:          { type: Number, min: 0, max: 100 },
  notes:          { type: String, trim: true },
})

/* Un DEA posé sur le site. Seule source de vérité du parc : la collection
   Installation a été supprimée au profit de ces sous-documents. */
const deaSchema = new mongoose.Schema({
  product:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  deviceType:   { type: String, trim: true },   // libellé affiché (nom du produit ou saisie libre)
  serialNumber: { type: String, trim: true },
  location:     { type: String, trim: true },   // emplacement précis dans le site (hall, étage 2…)

  // Cycle de vie de la pose : planifiée (à installer) → posée (installé).
  status:         { type: String, enum: ['a_installer', 'installe'], default: 'installe' },
  scheduledDate:  Date,
  technician:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  technicianName: { type: String, trim: true },
  contract:       { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },
  contractDate:   Date,
  controlType:    { type: String, enum: ['semestriel', 'annuel', ''], default: '' },

  installationDate: Date,
  nextControlDate:  Date,
  /* Échéance fixée à la main depuis la fiche client. Le calendrier du contrat
     ne la recalcule plus : le terrain sait mieux que la règle des six mois où
     en est un parc repris des années après sa pose. */
  nextControlManual: { type: Boolean, default: false },

  electrodes: { type: [electrodeSchema], default: [] },
  batteries:  { type: [batterySchema],   default: [] },

  notes: { type: String, trim: true },
}, { timestamps: true })

const siteSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },

  address: {
    street:      { type: String, trim: true },
    city:        { type: String, trim: true },
    governorate: { type: String, trim: true },
    gps: {
      lat: { type: Number },
      lng: { type: Number },
    },
  },

  contacts: { type: [contactSchema], default: [] },
  deas:     { type: [deaSchema],     default: [] },

  notes:     { type: String, trim: true },
  isActive:  { type: Boolean, default: true },
  // Dossier « Clients/<client>/Sites/<site> » de l'arborescence documentaire.
  documentsFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

siteSchema.index({ client: 1, name: 1 })
// Les DEA sont référencés par leur _id depuis interventions, contrôles et
// contrats : cet index rend la résolution site ← DEA directe.
siteSchema.index({ 'deas._id': 1 })
siteSchema.index({ 'deas.serialNumber': 1 })

module.exports = mongoose.model('Site', siteSchema)
