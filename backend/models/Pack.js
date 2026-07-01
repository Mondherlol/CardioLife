const mongoose = require('mongoose')

const packProductSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, default: 1, min: 1 },
}, { _id: false })

const packServiceSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  price: { type: Number, min: 0, default: 0 },
}, { _id: false })

const packSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  products:    [packProductSchema],
  services:    [packServiceSchema],
  // Prix bundle négocié, saisi manuellement. Le prix « théorique » est calculé
  // à partir des prix de vente des produits × quantité + prix des services.
  realPrice:   { type: Number, min: 0 },
  isActive:    { type: Boolean, default: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

packSchema.index({ name: 'text' })

module.exports = mongoose.model('Pack', packSchema)
