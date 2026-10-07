const mongoose = require('mongoose')
const { Schema } = mongoose

/**
 * Journal des suppressions.
 *
 * Supprimer une intervention l'efface des listes, pas de l'histoire : on garde
 * qui l'a supprimée, quand, pourquoi, et une copie complète du document tel
 * qu'il était — de quoi comprendre après coup, voire reconstituer.
 */
const deletionLogSchema = new Schema({
  kind:          { type: String, required: true, index: true },   // 'intervention'
  refId:         { type: Schema.Types.ObjectId, required: true, index: true },
  // Ce qu'on lit dans la liste, sans ouvrir la copie.
  label:         { type: String, trim: true },
  clientName:    { type: String, trim: true },
  siteName:      { type: String, trim: true },
  reason:        { type: String, trim: true },
  snapshot:      { type: Schema.Types.Mixed },
  deletedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  deletedByName: { type: String, trim: true },
  deletedAt:     { type: Date, default: Date.now, index: true },
})

module.exports = mongoose.model('DeletionLog', deletionLogSchema)
