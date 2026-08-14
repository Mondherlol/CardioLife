const mongoose = require('mongoose')

// Les anciens contrats peuvent porter d'autres types : la liste reste ouverte
// pour ne pas invalider ces documents, mais tout nouveau contrat est un
// contrat de maintenance.
const TYPES    = ['maintenance', 'location', 'vente', 'autre']
const STATUSES = ['brouillon', 'actif', 'expire', 'resilie']

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

  notes:     { type: String, trim: true },
  isActive:  { type: Boolean, default: true },   // archivage doux
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

contractSchema.index({ contractNumber: 'text', clientName: 'text', siteName: 'text' })
contractSchema.index({ client: 1, createdAt: -1 })

module.exports = mongoose.model('Contract', contractSchema)
module.exports.TYPES    = TYPES
module.exports.STATUSES = STATUSES
