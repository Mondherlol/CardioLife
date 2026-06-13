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
}, { timestamps: true })

documentSchema.index({ parent: 1, isDeleted: 1 })

module.exports = mongoose.model('Document', documentSchema)
