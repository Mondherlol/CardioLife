const mongoose = require('mongoose')

const documentSchema = new mongoose.Schema({
  path:         { type: String, required: true },
  originalName: { type: String },
  uploadedAt:   { type: Date, default: Date.now },
  uploadedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
})

const historySchema = new mongoose.Schema({
  action:  { type: String, required: true },
  by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at:      { type: Date, default: Date.now },
  details: { type: String },
}, { _id: false })

const formationSchema = new mongoose.Schema({
  client:                 { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  clientName:             { type: String, trim: true },
  title:                  { type: String, required: true, trim: true },
  date:                   { type: Date, required: true },
  description:            { type: String, trim: true },
  documents:              [documentSchema],
  attestationDelivered:   { type: Boolean, default: false },
  attestationDeliveredAt: { type: Date },
  attestationDeliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  history:                [historySchema],
  createdBy:              { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

formationSchema.index({ client: 1, date: -1 })

module.exports = mongoose.model('Formation', formationSchema)
