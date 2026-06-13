const mongoose = require('mongoose')

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    required: true,
    trim: true,
  },
  address: {
    street:      { type: String, trim: true },
    city:        { type: String, trim: true },
    governorate: { type: String, trim: true },
    gps: {
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  contact: {
    name:   { type: String, trim: true },
    phones: [{ type: String, trim: true }],
    emails: [{ type: String, trim: true, lowercase: true }],
  },
  internalManager: { type: String, trim: true },
  notes:           { type: String, trim: true },
  linkedDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
  isActive:        { type: Boolean, default: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true })

clientSchema.index({ name: 'text', 'address.city': 'text' })

module.exports = mongoose.model('Client', clientSchema)
