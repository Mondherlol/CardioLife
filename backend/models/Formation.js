const mongoose = require('mongoose')

const documentSchema = new mongoose.Schema({
  path:         { type: String, required: true },
  originalName: { type: String },
  uploadedAt:   { type: Date, default: Date.now },
  uploadedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
})

const historySchema = new mongoose.Schema({
  action:  { type: String, required: true },
  by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at:      { type: Date, default: Date.now },
  details: { type: String },
}, { _id: false })

/* Un agent du site inscrit à la formation. Il est nommé dès la programmation —
   c'est la liste que le formateur emporte — et son sort est tranché après la
   séance : formé, ou toujours à former (absent le jour J, à replanifier). */
const participantSchema = new mongoose.Schema({
  name:   { type: String, trim: true, required: true },
  role:   { type: String, trim: true },
  email:  { type: String, trim: true, lowercase: true },
  phone:  { type: String, trim: true },
  status: { type: String, enum: ['a_former', 'forme', 'absent'], default: 'a_former' },
  notes:  { type: String, trim: true },
})

/* Destinataire des attestations préparées. Repris du responsable du site à la
   création, modifiable ensuite : c'est l'adresse à laquelle l'assistante
   enverra les documents une fois la formation terminée. */
const attestationContactSchema = new mongoose.Schema({
  name:  { type: String, trim: true },
  role:  { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
}, { _id: false })

const formationSchema = new mongoose.Schema({
  client:                 { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  clientName:             { type: String, trim: true },
  // Site formé — facultatif : les formations d'avant cette version, et celles
  // organisées pour le client sans site précis, restent rattachées au client seul.
  site:                   { type: mongoose.Schema.Types.ObjectId, ref: 'Site', index: true },
  siteName:               { type: String, trim: true },
  // Places consommées sur le quota du site (16 par DAE posé). Recalculé depuis
  // `participants` dès qu'une liste nominative existe.
  participantsCount:      { type: Number, default: 0, min: 0 },
  participants:           { type: [participantSchema], default: [] },
  title:                  { type: String, required: true, trim: true },
  date:                   { type: Date, required: true },   // début de la formation
  end:                    { type: Date },                   // fin (date + durée) — pour le planning
  status:                 { type: String, enum: ['planifie', 'en_cours', 'fait', 'annule'], default: 'planifie' },
  assignedTo:             [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  description:            { type: String, trim: true },
  documents:              [documentSchema],
  attestationContact:     { type: attestationContactSchema, default: () => ({}) },
  attestationDelivered:   { type: Boolean, default: false },
  attestationDeliveredAt: { type: Date },
  attestationDeliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  history:                [historySchema],
  createdBy:              { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

/* Le quota du site se compte en personnes formées : dès qu'une liste nominative
   existe, c'est elle qui fait foi — les absents ne consomment pas de place. */
formationSchema.pre('save', function syncParticipantsCount(next) {
  if (this.participants?.length) {
    this.participantsCount = this.participants.filter(p => p.status !== 'absent').length
  }
  next()
})

formationSchema.index({ client: 1, date: -1 })
formationSchema.index({ site: 1, date: -1 })
formationSchema.index({ date: 1 })

module.exports = mongoose.model('Formation', formationSchema)
