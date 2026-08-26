const mongoose = require('mongoose')

/**
 * Un exemplaire physique — le 3e niveau du stock, sous la catégorie et le
 * modèle (`Product`).
 *
 * Pour les catégories suivies à l'unité (défibrillateurs), une ligne = un
 * appareil, identifié par son numéro de série, et `quantity` vaut 1.
 * Pour les catégories suivies par lot (électrodes, batteries), une ligne = un
 * lot avec sa DLC, et `quantity` porte le reliquat. Le même tableau sert donc
 * les deux cas.
 */

/* Ces statuts occupent une place dans l'entrepôt. */
const IN_STOCK_STATUSES = ['disponible', 'reserve', 'maintenance']
/* Ceux-là sont sortis du stock. */
const OUT_STATUSES = ['vendu', 'installe', 'hs']
const STATUSES = [...IN_STOCK_STATUSES, ...OUT_STATUSES]

const STATUS_LABELS = {
  disponible:  'Disponible',
  reserve:     'Réservé',
  maintenance: 'En maintenance',
  vendu:       'Vendu',
  installe:    'Installé',
  hs:          'Hors service',
}

/* Journal de vie de l'article : chaque changement d'état y laisse une trace. */
const historySchema = new mongoose.Schema({
  action: { type: String, trim: true, required: true },
  from:   { type: String, trim: true },
  to:     { type: String, trim: true },
  note:   { type: String, trim: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  date:   { type: Date, default: Date.now },
}, { _id: false })

const productItemSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  // Slug de la catégorie, dénormalisé : il permet de lister le parc d'une
  // catégorie sans repasser par les produits.
  category: { type: String, trim: true, index: true },

  // Référence article — reprend celle du modèle par défaut, mais reste
  // modifiable (référence fournisseur propre à l'exemplaire).
  reference:    { type: String, trim: true },
  serialNumber: { type: String, trim: true },
  lotNumber:    { type: String, trim: true },
  // DLC — portée par le lot pour les consommables, par l'appareil sinon.
  expirationDate: { type: Date },

  quantity: { type: Number, default: 1, min: 0 },

  supplier:      { type: String, trim: true },
  entryDate:     { type: Date, default: Date.now },
  purchasePrice: { type: Number, min: 0 },
  salePrice:     { type: Number, min: 0 },

  status: { type: String, enum: STATUSES, default: 'disponible', index: true },

  // Réservation : le matériel reste physiquement en stock mais n'est plus
  // disponible à la vente.
  reservedFor: {
    client:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    // Un article se réserve pour un lieu précis, pas seulement pour un client :
    // c'est ce site qui recevra la pose, et la fiche client s'appuie dessus.
    site:     { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },
    until:    { type: Date },
    note:     { type: String, trim: true },
  },

  saleDate: { type: Date },
  /* Mise en service de la pièce chez le client. Elle est saisie sur la fiche du
     DAE — c'est le terrain qui sait quand la batterie a été activée — et
     recopiée ici pour que le stock la lise sans passer par le parc. */
  activationDate: { type: Date },
  client:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
  site:     { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  // `_id` du sous-document DEA de `Site.deas` — le pont entre le stock et le parc.
  dea:      { type: mongoose.Schema.Types.ObjectId, index: true },

  // Mouvement de stock à l'origine de l'entrée, pour remonter au bon de réception.
  entryMovement: { type: mongoose.Schema.Types.ObjectId, ref: 'StockMovement' },

  notes:   { type: String, trim: true },
  history: { type: [historySchema], default: [] },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

// Un numéro de série ne peut désigner qu'un exemplaire d'un modèle donné. Index
// partiel : les lignes de lot n'ont pas de série et ne doivent pas s'y heurter.
productItemSchema.index(
  { product: 1, serialNumber: 1 },
  { unique: true, partialFilterExpression: { serialNumber: { $type: 'string' } } }
)
productItemSchema.index({ category: 1, status: 1 })
productItemSchema.index({ expirationDate: 1 })
productItemSchema.index({ serialNumber: 1 })

module.exports = mongoose.model('ProductItem', productItemSchema)
module.exports.STATUSES          = STATUSES
module.exports.IN_STOCK_STATUSES = IN_STOCK_STATUSES
module.exports.OUT_STATUSES      = OUT_STATUSES
module.exports.STATUS_LABELS     = STATUS_LABELS
