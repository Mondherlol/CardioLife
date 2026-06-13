const mongoose = require('mongoose')
const { Schema } = mongoose

const rapportSchema = new Schema({
  dae:           { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  batterie:      { type: String, enum: ['conforme','non_conforme','remplacee',''],   default: '' },
  electrodes:    { type: String, enum: ['conformes','non_conformes','remplacees',''],default: '' },
  boitier:       { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  signalisation: { type: String, enum: ['conforme','non_conforme',''],               default: '' },
  observations:  { type: String, trim: true },
  nextControlDate: Date,
}, { _id: false })

const controlSchema = new Schema({
  installation:  { type: Schema.Types.ObjectId, ref: 'Installation', required: true },
  client:        { type: Schema.Types.ObjectId, ref: 'Client' },
  clientName:    { type: String, trim: true },
  type:          { type: String, enum: ['semestriel','annuel'], required: true },
  status:        { type: String, enum: ['a_venir','termine'], default: 'a_venir' },
  scheduledDate: { type: Date, required: true },
  completedDate: Date,
  technicien:    { type: Schema.Types.ObjectId, ref: 'User' },
  technicienName:{ type: String, trim: true },
  rapport:       { type: rapportSchema, default: () => ({}) },
  sentToClient:  { type: Boolean, default: false },
  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

controlSchema.index({ installation: 1, scheduledDate: 1 })
controlSchema.index({ client: 1, scheduledDate: 1 })

module.exports = mongoose.model('Control', controlSchema)
