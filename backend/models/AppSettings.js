const mongoose = require('mongoose')

/**
 * Identité de l'entreprise, telle qu'elle s'imprime en tête des documents
 * (bon d'intervention aujourd'hui, devis et attestations demain).
 *
 * Les valeurs par défaut sont celles du papier à en-tête actuel : une base
 * neuve édite déjà des bons corrects, et l'écran Paramètres sert à corriger,
 * pas à tout ressaisir. Les champs multilignes (adresse, téléphones, pied de
 * page) sont laissés en texte libre — le papier les met sur deux lignes et
 * découper en sous-champs ne ferait qu'ajouter des cases à remplir.
 */
const companySchema = new mongoose.Schema({
  name:    { type: String, trim: true, default: 'CARDIO life' },
  // Fichier déposé dans `uploads/company`. Vide = logo livré avec l'app.
  logo:    { type: String, default: null },
  address: { type: String, trim: true, default: 'Avenue 18 Janvier 1952\nAriana Centre 2ème Etage' },
  city:    { type: String, trim: true, default: "2080 L'ARIANA" },
  phone:   { type: String, trim: true, default: '71 714 063 – 31 119 719\n27 629 217 – 53 629 529' },
  email:   { type: String, trim: true, default: 'info@cardiolife.tn' },
  website: { type: String, trim: true, default: 'www.cardiolife.tn' },
  // Matricule fiscal, imprimé sous la date du bon.
  taxId:   { type: String, trim: true, default: '1446928Z/B/M/000' },
  // Bas de page du document : coordonnées du bureau, MF et RIB.
  footer:  {
    type: String, trim: true,
    default: "BUREAU : Av 18 Janvier 1952 Centre Ariana 2ème Etage B.208A - L'ARIANA CP Ville 2080\nMF : 000/M/B/1446928/Z – BIAT 08 307 0005910015690 80",
  },
}, { _id: false })

const schema = new mongoose.Schema({
  maxFileSizeMB:         { type: Number, default: 50 },
  maxTotalSpaceMB:       { type: Number, default: 2048 },
  defaultUploadFolderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  company:               { type: companySchema, default: () => ({}) },
}, { timestamps: true })

module.exports = mongoose.model('AppSettings', schema)
