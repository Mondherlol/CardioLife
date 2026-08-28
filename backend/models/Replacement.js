const mongoose = require('mongoose')
const { Schema } = mongoose

/**
 * Demande de remplacement d'un élément défectueux du parc.
 *
 * Deux situations du terrain, un seul enregistrement :
 *  - `a_remplacer` : le technicien signale une pièce défectueuse qu'il n'a pas
 *    de quoi changer sur place. Quelqu'un traitera la demande.
 *  - `remplace`    : il a fait le remplacement pendant sa visite et le consigne.
 *
 * La pièce est désignée par son numéro de série (DEA, batterie) ou son numéro
 * de lot (électrodes) : c'est ce que le technicien a sous les yeux. Quand ce
 * numéro correspond à un article du stock, le lien est établi et l'article
 * passe hors service — sinon la demande reste purement déclarative.
 */

const KINDS = ['dae', 'batterie', 'electrodes']
const KIND_LABELS = {
  dae:        'Défibrillateur',
  batterie:   'Batterie',
  electrodes: 'Électrodes',
}

/* `a_remplacer` et `remplace` sont deux points d'entrée, pas deux étapes : une
   demande peut naître déjà soldée. */
const STATUSES = ['a_remplacer', 'remplace', 'annule']
const STATUS_LABELS = {
  a_remplacer: 'À remplacer',
  remplace:    'Remplacé',
  annule:      'Annulé',
}

const REASONS = ['defectueux', 'perime', 'manquant', 'endommage', 'fin_de_vie', 'autre']
const REASON_LABELS = {
  defectueux: 'Défectueux',
  perime:     'Périmé',
  manquant:   'Manquant',
  endommage:  'Endommagé',
  fin_de_vie: 'Fin de vie',
  autre:      'Autre',
}

const historySchema = new Schema({
  action:   { type: String, trim: true },
  from:     { type: String, trim: true },
  to:       { type: String, trim: true },
  note:     { type: String, trim: true },
  user:     { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, trim: true },
  date:     { type: Date, default: Date.now },
}, { _id: false })

const replacementSchema = new Schema({
  client:   { type: Schema.Types.ObjectId, ref: 'Client', index: true },
  site:     { type: Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  // `_id` du DEA concerné dans `Site.deas` — le parc n'a pas de collection.
  dea:      { type: Schema.Types.ObjectId, index: true },
  // Étiquette lisible de l'appareil au moment de la demande : elle survit à une
  // modification du parc, contrairement au lien.
  deaLabel: { type: String, trim: true },

  kind:   { type: String, enum: KINDS,   required: true },
  status: { type: String, enum: STATUSES, default: 'a_remplacer', index: true },
  reason: { type: String, enum: REASONS, default: 'defectueux' },

  /* ── Pièce défectueuse ── */
  serialNumber: { type: String, trim: true },
  lotNumber:    { type: String, trim: true },
  productName:  { type: String, trim: true },
  product:      { type: Schema.Types.ObjectId, ref: 'Product' },
  // Article du stock reconnu par son numéro, s'il existe.
  faultyItem:   { type: Schema.Types.ObjectId, ref: 'ProductItem' },

  /* ── Pièce de remplacement ── */
  // Réservée à la demande, ou posée quand le remplacement est déjà fait.
  replacementItem:   { type: Schema.Types.ObjectId, ref: 'ProductItem' },
  replacementSerial: { type: String, trim: true },
  /* Péremption de la pièce posée. Relevée sur l'étiquette au moment de la pose :
     c'est elle qui part sur la fiche du DAE, et elle ne se déduit de rien quand
     la pièce vient d'ailleurs que du stock. */
  replacementExpiry: { type: Date },
  replacedAt:        { type: Date },

  notes: { type: String, trim: true },

  // Contrôle au cours duquel le problème a été constaté.
  intervention: { type: Schema.Types.ObjectId, ref: 'Intervention', index: true },

  requestedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  requestedByName: { type: String, trim: true },

  history: { type: [historySchema], default: [] },
}, { timestamps: true })

replacementSchema.index({ status: 1, createdAt: -1 })
replacementSchema.index({ site: 1, status: 1 })

module.exports = mongoose.model('Replacement', replacementSchema)
module.exports.KINDS         = KINDS
module.exports.KIND_LABELS   = KIND_LABELS
module.exports.STATUSES      = STATUSES
module.exports.STATUS_LABELS = STATUS_LABELS
module.exports.REASONS       = REASONS
module.exports.REASON_LABELS = REASON_LABELS
