const mongoose = require('mongoose')

const personSchema = new mongoose.Schema({
  name:  { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
}, { _id: false })

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
  contacts:         [personSchema],
  internalManagers: [personSchema],
  notes:            { type: String, trim: true },
  documentsFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  isActive:        { type: Boolean, default: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true })

clientSchema.index({ name: 'text', 'address.city': 'text' })

module.exports = mongoose.model('Client', clientSchema)
