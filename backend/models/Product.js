const mongoose = require('mongoose')

const CATEGORIES = [
  'defibrillateur',
  'batterie',
  'electrodes_adulte',
  'electrodes_enfant',
  'boitier',
  'signaletique',
  'accessoire',
  'kit_secours',
  'mannequin',
  'trainer',
  'autre',
]

const productSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  reference: { type: String, trim: true },
  brand:     { type: String, trim: true },
  description: { type: String },
  category: {
    type: String,
    enum: CATEGORIES,
    required: true,
  },
  deviceMode:           { type: String, enum: ['automatique', 'semi-automatique'] },
  requiresSerialNumber: { type: Boolean, default: false },
  requiresLotNumber:    { type: Boolean, default: false },
  stock:          { type: Number, default: 0, min: 0 },
  alertThreshold: { type: Number, default: 5, min: 0 },
  purchasePrice:  { type: Number, min: 0 },
  salePrice:      { type: Number, min: 0 },
  supplier:       { type: String, trim: true },
  notes:          { type: String, trim: true },
  images:         [{ type: String }],
  webCard: {
    title:       { type: String, trim: true },
    badges:      [{ type: String, trim: true }],
    rating:      { type: Number, min: 0, max: 5, default: 5.0 },
    ratingLabel: { type: String, trim: true, default: 'Certifié' },
    slug:        { type: String, trim: true },
    description: { type: String },
    features:    [{ type: String, trim: true }],
    footerText:  { type: String, trim: true, default: 'Réponse garantie sous 24h · Livraison en Tunisie' },
  },
  listedOnWebsite: { type: Boolean, default: true },
  isActive:        { type: Boolean, default: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true })

productSchema.index({ name: 'text', reference: 'text', brand: 'text' })

module.exports = mongoose.model('Product', productSchema)
module.exports.CATEGORIES = CATEGORIES
