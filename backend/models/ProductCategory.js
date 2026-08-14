const mongoose = require('mongoose')

/* Palette proposée dans les paramètres — les valeurs correspondent aux classes
   `cat--<color>` du front. */
const COLORS = ['orange', 'amber', 'blue', 'purple', 'teal', 'green', 'red', 'gray', 'pink', 'indigo']

const productCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, unique: true },

  icon:  { type: String, trim: true, default: 'Package' },   // nom d'icône lucide
  color: { type: String, enum: COLORS, default: 'gray' },
  image: { type: String, trim: true },                       // URL d'illustration (optionnelle)

  description: { type: String, trim: true },

  // La traçabilité se décide au niveau de la catégorie : les produits en
  // héritent à la création. Les compteurs de péremption ne concernent que
  // les catégories suivies par lot.
  tracksSerial: { type: Boolean, default: false },
  tracksLot:    { type: Boolean, default: false },

  // Suivi unitaire : la catégorie s'ouvre sur la liste de ses modèles, puis sur
  // le détail exemplaire par exemplaire (collection ProductItem) au lieu de la
  // grille de tuiles. Réservé au matériel qui a une vie propre — défibrillateurs,
  // consommables à DLC…
  tracksItems: { type: Boolean, default: false },

  order:    { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

productCategorySchema.index({ order: 1, name: 1 })

module.exports = mongoose.model('ProductCategory', productCategorySchema)
module.exports.COLORS = COLORS
