const mongoose = require('mongoose')
const { Schema } = mongoose

const rapportSchema = new Schema({
  dae:          { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  armoire:      { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  signaletique: { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  batterie:     { type: String, enum: ['conforme','non_conforme','remplacee',''],   default: '' },
  electrodes:   { type: String, enum: ['conformes','non_conformes','remplacees',''],default: '' },
  observations: { type: String, trim: true },
  dateVisite:   Date,
}, { _id: false })

const ficheSchema = new Schema({
  serialNumber:        { type: String, trim: true },
  emplacement:         { type: String, trim: true },
  signaletique:        { type: String, trim: true },
  batteriePct:         { type: Number, min: 0, max: 100 },
  batterieNote:        { type: String, trim: true },
  electrodesPct:       { type: Number, min: 0, max: 100 },
  electrodesNote:      { type: String, trim: true },
  armoire:             { type: String, trim: true },
  observation:         { type: String, trim: true },
  photos:              { type: [String], default: [] },
  dateReception:       Date,
  visa:                { type: String, trim: true },
  observationGenerale: { type: String, trim: true },
}, { _id: false })

const historySchema = new Schema({
  action:   { type: String },
  user:     { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String },
  date:     { type: Date, default: Date.now },
  details:  { type: String },
}, { _id: false })

const interventionSchema = new Schema({
  client:     { type: Schema.Types.ObjectId, ref: 'Client' },
  clientName: { type: String, trim: true },

  installation: { type: Schema.Types.ObjectId, ref: 'Installation' },
  installationSnap: {
    deviceType:   String,
    serialNumber: String,
    address:      String,
    location:     String,
  },

  technicien:     { type: Schema.Types.ObjectId, ref: 'User' },
  technicienName: { type: String, trim: true },

  status:        { type: String, enum: ['planifie','en_cours','termine'], default: 'planifie' },
  scheduledDate: Date,
  completedDate: Date,

  rapport:  { type: rapportSchema, default: () => ({}) },
  fiche:    { type: ficheSchema,   default: () => ({}) },
  history:  { type: [historySchema], default: [] },
  notes:    { type: String, trim: true },
  createdBy:{ type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

interventionSchema.index({ technicien: 1, scheduledDate: -1 })
interventionSchema.index({ client: 1, scheduledDate: -1 })
interventionSchema.index({ status: 1 })

module.exports = mongoose.model('Intervention', interventionSchema)
