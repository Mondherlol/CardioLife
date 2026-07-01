const mongoose = require('mongoose')

const TYPES    = ['maintenance', 'location', 'vente', 'autre']
const STATUSES = ['brouillon', 'actif', 'expire', 'resilie']

// Ligne de contrat : un produit couvert (issu d'un pack ou ajouté seul).
const lineItemSchema = new mongoose.Schema({
  product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String, trim: true },
  category:    { type: String, trim: true },
  quantity:    { type: Number, default: 1, min: 1 },
  unitPrice:   { type: Number, min: 0, default: 0 },
  fromPack:    { type: String, trim: true },   // nom du pack d'origine, le cas échéant
}, { _id: false })

const serviceSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  price:    { type: Number, min: 0, default: 0 },
  fromPack: { type: String, trim: true },
}, { _id: false })

const packRefSchema = new mongoose.Schema({
  pack: { type: mongoose.Schema.Types.ObjectId, ref: 'Pack' },
  name: { type: String, trim: true },
}, { _id: false })

const contractSchema = new mongoose.Schema({
  contractNumber: { type: String, trim: true },
  client:     { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  clientName: { type: String, trim: true },

  type:   { type: String, enum: TYPES,    default: 'maintenance' },
  status: { type: String, enum: STATUSES, default: 'actif' },

  startDate: { type: Date },
  endDate:   { type: Date },
  controlPeriodicity: { type: String, enum: ['semestriel', 'annuel', ''], default: '' },

  // Installations couvertes (créées depuis les packs/produits ou rattachées)
  installations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Installation' }],

  packs:     [packRefSchema],
  lineItems: [lineItemSchema],
  services:  [serviceSchema],

  // Valeur estimée = Σ (lignes produits × quantité) + Σ services. Calculée à l'enregistrement.
  estimatedValue: { type: Number, min: 0, default: 0 },

  notes:     { type: String, trim: true },
  isActive:  { type: Boolean, default: true },   // archivage doux
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

contractSchema.index({ contractNumber: 'text', clientName: 'text' })
contractSchema.index({ client: 1, createdAt: -1 })

module.exports = mongoose.model('Contract', contractSchema)
module.exports.TYPES    = TYPES
module.exports.STATUSES = STATUSES
