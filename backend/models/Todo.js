const mongoose = require('mongoose')
const { Schema } = mongoose

/**
 * Suivi interne des demandes d'évolution et des correctifs.
 *
 * Le besoin est celui d'un tableau partagé entre l'éditeur et l'équipe
 * CardioLife : ce qui a été demandé, où ça en est, et depuis quand. Pas un
 * gestionnaire de projet — une liste que l'on tient à jour en un clic.
 *
 * `source` garde la trace de la demande d'origine (date du mail, appel
 * téléphonique) : sans elle, six semaines plus tard, personne ne sait plus
 * d'où sort une ligne ni si elle est encore d'actualité.
 */
const linkSchema = new Schema({
  label: { type: String, trim: true },
  url:   { type: String, trim: true, required: true },
}, { _id: false })

const todoSchema = new Schema({
  title:    { type: String, required: true, trim: true },
  notes:    { type: String, trim: true, default: '' },

  status:   { type: String, enum: ['todo', 'doing', 'done'], default: 'todo', index: true },
  priority: { type: String, enum: ['basse', 'normale', 'haute'], default: 'normale' },

  /* Regroupement métier — « Checklist », « Rapport », « Droits »… Champ libre
     plutôt qu'énumération : les thèmes évoluent au fil des retours. */
  category: { type: String, trim: true, default: '' },

  /* D'où vient la demande : « Mail du 28/08/2026 », « Appel M. Mounir ». */
  source:   { type: String, trim: true, default: '' },
  /* Date de la demande, pour trier par ancienneté. */
  requestedAt: Date,
  dueDate:     Date,
  completedAt: Date,

  /* ── Colonnes du tableau de suivi ──────────────────────────
     `response` est du HTML restreint (voir `sanitizeHtml` du contrôleur) :
     l'équipe y colle indifféremment du texte, un lien ou une capture. Un champ
     unique plutôt que trois — on ne veut pas choisir un formulaire avant de
     pouvoir répondre. */
  response: { type: String, default: '' },

  /* Validation par l'équipe CardioLife : c'est eux qui tranchent, pas nous.
     `pending` tant que personne ne s'est prononcé. */
  validation: { type: String, enum: ['pending', 'ok', 'ko'], default: 'pending', index: true },
  validatedAt: Date,
  /* Retours de l'équipe sur la réponse apportée — même format libre. */
  feedback: { type: String, default: '' },

  links:  { type: [linkSchema], default: [] },
  /* Noms de fichiers dans uploads/todos. Les images collées dans `response`
     ou `feedback` y sont référencées : la liste sert au ménage à la
     suppression d'une ligne. */
  images: { type: [String], default: [] },

  /* Ordre d'affichage manuel : les lignes se réordonnent à la main. */
  position: { type: Number, default: 0 },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

todoSchema.index({ status: 1, position: 1 })

module.exports = mongoose.model('Todo', todoSchema)
