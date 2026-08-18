const mongoose = require('mongoose')
const { Schema } = mongoose

const rapportSchema = new Schema({
  dae:          { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  armoire:      { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  signaletique: { type: String, enum: ['conforme','non_conforme','remplace',''],    default: '' },
  batterie:     { type: String, enum: ['conforme','non_conforme','remplacee',''],   default: '' },
  electrodes:   { type: String, enum: ['conformes','non_conformes','remplacees',''],default: '' },
  observations: { type: String, trim: true },
  dateVisite:   Date,
}, { _id: false })

/**
 * Fiche de contrôle d'UN appareil, calquée sur la checklist papier de
 * maintenance des consommables DAE.
 *
 * Une visite couvre souvent plusieurs DAE du même site : l'intervention en
 * porte donc une liste (`fiches`), une par appareil contrôlé, identifiée par
 * `dea` (l'_id du sous-document dans `Site.deas`).
 *
 * Les points de contrôle sont des booléens à trois états : `true` conforme,
 * `false` non conforme, `undefined` pas encore vérifié. Un champ non renseigné
 * ne doit pas se lire comme un défaut.
 */
const ficheSchema = new Schema({
  // Appareil concerné. `null` sur les fiches d'avant les visites multi-DAE.
  dea:                 { type: Schema.Types.ObjectId },
  deaLabel:            { type: String, trim: true },

  serialNumber:        { type: String, trim: true },
  emplacement:         { type: String, trim: true },
  signaletique:        { type: String, trim: true },

  /* ── Batterie ── */
  batteriePeremption:  Date,
  batteriePct:         { type: Number, min: 0, max: 100 },
  // Absence de détérioration ou de corrosion.
  batterieEtat:        { type: Boolean },
  batterieRemplacee:   { type: Boolean },
  // Pièce effectivement montée : « remplacée » sans dire laquelle ne se
  // rapproche d'aucun mouvement de stock.
  batterieRemplaceeRef: { type: String, trim: true },
  batterieNote:        { type: String, trim: true },

  /* ── Électrodes ── */
  // Deux jeux distincts sur la checklist : adulte (A) et pédiatrique (P).
  electrodesPeremptionAdulte:     Date,
  electrodesPeremptionPediatrique: Date,
  // Intégrité de l'emballage hermétique.
  electrodesEmballage:  { type: Boolean },
  // Présence des électrodes adaptées aux besoins du site.
  electrodesAdaptees:   { type: Boolean },
  electrodesType:       { type: String, enum: ['capteur_rcp', 'sans_capteur_rcp', 'universelle', ''], default: '' },
  electrodesRemplacees: { type: Boolean },
  electrodesRemplaceesRef: { type: String, trim: true },
  electrodesPct:        { type: Number, min: 0, max: 100 },
  electrodesNote:       { type: String, trim: true },

  /* ── Kit de secours ── */
  kitGants:      { type: Boolean },
  kitCiseaux:    { type: Boolean },
  kitRasoir:     { type: Boolean },
  kitMasque:     { type: Boolean },
  kitCompresses: { type: Boolean },
  kitRemplace:   { type: Boolean },
  kitRemplaceRef: { type: String, trim: true },

  /* ── État général du DAE ── */
  voyantVert:      { type: Boolean },
  autotests:       { type: Boolean },
  // Armoire accessible et correctement signalée (ex-« boîtier »).
  armoire:         { type: String, trim: true },
  armoireAccessible: { type: Boolean },
  armoirePiles:      { type: Boolean },

  /* ── Suivi documentaire ── */
  dernierControle:  Date,
  prochainControle: Date,

  observation:         { type: String, trim: true },
  photos:              { type: [String], default: [] },
  dateReception:       Date,
  visa:                { type: String, trim: true },
  observationGenerale: { type: String, trim: true },
}, { _id: false })

const historySchema = new Schema({
  action:   { type: String },
  user:     { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String },
  date:     { type: Date, default: Date.now },
  details:  { type: String },
}, { _id: false })

const interventionSchema = new Schema({
  client:     { type: Schema.Types.ObjectId, ref: 'Client' },
  clientName: { type: String, trim: true },

  // Site visité. Les contrôles générés par un contrat portent sur le site
  // entier ; ceux planifiés depuis un appareil précisent en plus `installation`.
  site:       { type: Schema.Types.ObjectId, ref: 'Site', index: true },
  siteName:   { type: String, trim: true },

  // _id du DEA concerné dans `Site.deas` (le parc n'a plus de collection propre).
  installation: { type: Schema.Types.ObjectId },
  installationSnap: {
    deviceType:   String,
    serialNumber: String,
    address:      String,
    location:     String,
  },

  technicien:     { type: Schema.Types.ObjectId, ref: 'User' },
  technicienName: { type: String, trim: true },

  // Type de contrôle : issu d'un contrat (semestriel/annuel) ou hors contrat
  // (planifié manuellement depuis la fiche d'une installation).
  controlType:   { type: String, enum: ['semestriel','annuel','hors_contrat'], default: 'hors_contrat' },
  contract:      { type: Schema.Types.ObjectId, ref: 'Contract' },

  status:        { type: String, enum: ['planifie','en_cours','termine'], default: 'planifie' },
  scheduledDate: Date,
  /* Date déplacée à la main (fiche client). Le calendrier du contrat ne la
     réaligne plus : une reprise de parc ancien vaut mieux que la règle. */
  manualDate:    { type: Boolean, default: false },
  completedDate: Date,

  rapport:  { type: rapportSchema, default: () => ({}) },

  /* Une fiche par appareil contrôlé pendant la visite. */
  fiches:   { type: [ficheSchema], default: [] },
  /* Miroir de `fiches[0]`, tenu à jour à chaque enregistrement : les lectures
     historiques (impression, exports) continuent de fonctionner telles quelles. */
  fiche:    { type: ficheSchema,   default: () => ({}) },

  /* Ce qui vaut pour la visite entière, quel que soit le nombre d'appareils. */
  visite: {
    dateReception:       Date,
    visa:                { type: String, trim: true },
    observationGenerale: { type: String, trim: true },
  },

  history:  { type: [historySchema], default: [] },
  notes:    { type: String, trim: true },
  createdBy:{ type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

interventionSchema.index({ technicien: 1, scheduledDate: -1 })
interventionSchema.index({ client: 1, scheduledDate: -1 })
interventionSchema.index({ status: 1 })

module.exports = mongoose.model('Intervention', interventionSchema)
