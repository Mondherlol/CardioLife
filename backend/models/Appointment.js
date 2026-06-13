const mongoose = require('mongoose')

const appointmentSchema = new mongoose.Schema({
  title:        { type: String, required: true, trim: true },
  start:        { type: Date,   required: true },
  end:          { type: Date },
  allDay:       { type: Boolean, default: false },
  type:         { type: String, enum: ['controle','intervention','installation','formation','reunion','autre'], default: 'autre' },
  status:       { type: String, enum: ['planifie','en_cours','fait','annule'], default: 'planifie' },
  description:  { type: String, trim: true },
  client:       { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientName:   { type: String, trim: true },
  installation: { type: mongoose.Schema.Types.ObjectId, ref: 'Installation' },
  assignedTo:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

appointmentSchema.index({ start: 1 })

module.exports = mongoose.model('Appointment', appointmentSchema)
