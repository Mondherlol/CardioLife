const mongoose = require('mongoose')

// Les anciens contrats peuvent porter d'autres types : la liste reste ouverte
// pour ne pas invalider ces documents, mais tout nouveau contrat est un
// contrat de maintenance.
const TYPES    = ['maintenance', 'location', 'vente', 'autre']
const STATUSES = ['brouillon', 'actif', 'expire', 'resilie']

/* Hausse de prix appliquée à l'approche d'un contrôle annuel. Rattachée au
   contrôle qui l'a déclenchée : une même échéance ne relève jamais deux fois
   le prix, même si le bouton est pressé deux fois. */
const priceIncreaseSchema = new mongoose.Schema({
  control:   { type: mongoose.Schema.Types.ObjectId, ref: 'Intervention', required: true },
  from:      { type: Number, required: true },
  to:        { type: Number, required: true },
  rate:      { type: Number, required: true },
  appliedAt: { type: Date, default: Date.now },
  appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false })

/* Une période du contrat : la première, puis chaque renouvellement. C'est
   l'historique des durées et des prix — le prix noté est celui en vigueur au
   début de la période, les hausses annuelles restant dans `priceIncreases`.
   Une période « offerte » n'est pas facturée (année gratuite). */
const periodSchema = new mongoose.Schema({
  start:     { type: Date, required: true },
  end:       { type: Date, required: true },
  price:     { type: Number, min: 0 },
  free:      { type: Boolean, default: false },
  kind:      { type: String, enum: ['initial', 'renouvellement'], default: 'initial' },
  auto:      { type: Boolean, default: false },   // renouvelée sans intervention
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
})

/* Résiliation demandée : immédiate, ou à une date — le contrat court
   jusque-là puis passe « résilié » de lui-même. */
const terminationSchema = new mongoose.Schema({
  date:        { type: Date, required: true },
  reason:      { type: String, trim: true },
  requestedAt: { type: Date, default: Date.now },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false })

/**
 * Contrat de maintenance d'un site.
 *
 * Un client peut avoir plusieurs sites, chacun avec son parc et son propre
 * calendrier de visites : le contrat est donc rattaché au site. Le client reste
 * dénormalisé pour filtrer et regrouper sans jointure.
 *
 * Le contrat ne décrit pas son contenu : les DAE couverts sont, par définition,
 * ceux installés sur le site. Ils sont calculés à la lecture depuis
 * `Site.deas`, jamais stockés ici.
 *
 * La périodicité n'est pas non plus un réglage : les contrôles sont toujours
 * semestriels, le second de chaque année valant contrôle annuel.
 */
const contractSchema = new mongoose.Schema({
  contractNumber: { type: String, trim: true },
  site:       { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  siteName:   { type: String, trim: true },
  client:     { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  clientName: { type: String, trim: true },

  type:   { type: String, enum: TYPES,    default: 'maintenance' },
  status: { type: String, enum: STATUSES, default: 'actif' },

  startDate: { type: Date },
  endDate:   { type: Date },

  // Prix du contrat. Relevé de 5 % deux mois avant chaque contrôle annuel.
  price:          { type: Number, min: 0 },
  /* Tarif propre à chaque DAE du site, le prix variant selon le modèle. Dès
     qu'il y en a un, `price` en est la somme : listes, totaux et hausses
     annuelles continuent de lire `price`. */
  deaPrices: {
    type: [new mongoose.Schema({
      dea:   { type: mongoose.Schema.Types.ObjectId, required: true },
      price: { type: Number, min: 0, required: true },
    }, { _id: false })],
    default: [],
  },
  priceIncreases: { type: [priceIncreaseSchema], default: [] },

  /* Renouvellement : à l'échéance, une nouvelle période de `renewalMonths`
     s'ouvre d'elle-même au prix courant. `nextFree` rend la prochaine
     période offerte ; `freePeriod` dit si la période en cours l'est (lu par
     les totaux, qui ne comptent pas une année gratuite). */
  autoRenew:     { type: Boolean, default: true },
  renewalMonths: { type: Number, default: 12, min: 1, max: 120 },
  nextFree:      { type: Boolean, default: false },
  freePeriod:    { type: Boolean, default: false },
  periods:       { type: [periodSchema], default: [] },
  termination:   { type: terminationSchema },

  notes:    { type: String, trim: true },
  isActive:  { type: Boolean, default: true },   // archivage doux
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

contractSchema.index({ contractNumber: 'text', clientName: 'text', siteName: 'text' })
contractSchema.index({ client: 1, createdAt: -1 })

module.exports = mongoose.model('Contract', contractSchema)
module.exports.TYPES    = TYPES
module.exports.STATUSES = STATUSES
