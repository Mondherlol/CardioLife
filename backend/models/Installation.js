const mongoose = require('mongoose')

const batteryItemSchema = new mongoose.Schema({
  product:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName:    String,
  expiryDate:     Date,
  activationDate: Date,
  level:          { type: Number, min: 0, max: 100 },
  notes:          String,
}, { _id: false })

const electrodeItemSchema = new mongoose.Schema({
  product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: String,
  expiryDate:  Date,
  notes:       String,
}, { _id: false })

const installationSchema = new mongoose.Schema({
  // Client
  client:     { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientName: { type: String, required: true, trim: true },

  // Cycle de vie : à installer (planifiée, en attente) → installé (posé sur site)
  status: { type: String, enum: ['a_installer', 'installe'], default: 'installe' },

  // Planification de la pose (utilisé quand status = a_installer)
  scheduledDate:  Date,
  technician:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  technicianName: { type: String, trim: true },
  contract:       { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },

  // Location
  address:  { type: String, required: true, trim: true },
  location: { type: String, trim: true },

  // Dates
  contractDate:     Date,
  installationDate: Date,
  nextControlDate:  Date,

  // Device
  deviceProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  deviceType:    { type: String, trim: true },   // product name for quick display
  serialNumber:  { type: String, trim: true },

  // Components
  batteries:  { type: [batteryItemSchema],  default: [] },
  electrodes: { type: [electrodeItemSchema], default: [] },

  controlType: { type: String, enum: ['semestriel','annuel',''], default: '' },

  notes: String,

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

installationSchema.index({
  clientName:   'text',
  address:      'text',
  location:     'text',
  serialNumber: 'text',
  deviceType:   'text',
})

module.exports = mongoose.model('Installation', installationSchema)
