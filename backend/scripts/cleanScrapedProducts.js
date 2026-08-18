/**
 * Reprise du catalogue importé depuis le site vitrine.
 *
 * Le scraping a rempli les fiches avec ce que la page web pouvait donner, et
 * ce n'était pas la bonne matière :
 *
 *   • la catégorie suit les rayons du site — électrodes et kits de secours y
 *     voisinent avec les batteries. Le sélecteur d'électrodes de la fiche DAE
 *     filtre par catégorie : rangées ailleurs, elles y sont introuvables ;
 *   • la référence est l'adresse de la page (« cardiolife:aivia-100 ») ;
 *   • la description est du HTML WordPress, illisible en cellule Excel ;
 *   • le mode a été deviné en cherchant « automatique » dans la page, si bien
 *     qu'une armoire est automatique ;
 *   • la traçabilité (n° de série / n° de lot) a été posée au rayon, pas au
 *     produit : une sacoche demande un numéro de série, une batterie non.
 *
 * Idempotent — relançable sans risque. Rien n'est supprimé.
 *
 * Usage :
 *   node scripts/cleanScrapedProducts.js --dry        simulation détaillée
 *   node scripts/cleanScrapedProducts.js              applique
 *   node scripts/cleanScrapedProducts.js --garder-html  laisse les descriptions telles quelles
 *   node scripts/cleanScrapedProducts.js --archiver-tests  archive les fiches d'essai
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')
const {
  htmlToText, isScrapeReference, scrapeSlug,
  productKind, expectedTracking, modeApplies, KIND_CATEGORY,
  looksLikeTestRecord,
} = require('../utils/productCleanup')

const DRY        = process.argv.includes('--dry')
const KEEP_HTML  = process.argv.includes('--garder-html')
const ARCHIVE    = process.argv.includes('--archiver-tests')

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/**
 * Rayon qui convient à cette nature de produit, parmi ceux qui existent
 * réellement. Sans correspondance, on ne déplace rien : inventer une catégorie
 * depuis un script laisserait son paramétrage au hasard.
 */
function targetCategory(kind, categories) {
  for (const hint of KIND_CATEGORY[kind] || []) {
    const found = categories.find(c => norm(c.slug).includes(hint) || norm(c.name).includes(hint))
    if (found) return found
  }
  return null
}

/** Ce qu'il faudrait changer sur une fiche, et pourquoi. */
function planFor(product, categories) {
  const current = categories.find(c => c.slug === product.category)
  const kind    = productKind(product.name, current?.name || product.category)
  const changes = []
  const set     = {}
  const unset   = {}

  /* Catégorie — le correctif qui compte : une électrode rangée dans les
     batteries ne remonte pas dans le sélecteur d'électrodes du parc. */
  const target = targetCategory(kind, categories)
  if (target && target.slug !== product.category) {
    set.category = target.slug
    changes.push(`catégorie : ${current?.name || product.category} → ${target.name}`)
  }

  /* Référence — le slug de la page web n'est pas une référence fabricant. On
     le garde comme identifiant de la fiche vitrine, où il a du sens, et on
     libère la colonne pour la vraie référence, saisie plus tard dans Excel. */
  if (isScrapeReference(product.reference)) {
    const slug = scrapeSlug(product.reference)
    set.reference = ''
    if (!product.webCard?.slug) set['webCard.slug'] = slug
    changes.push(`référence : « ${product.reference} » retirée (slug conservé en fiche web)`)
  }

  /* Description — le HTML du CMS devient du texte, listes et paragraphes
     conservés. C'est ce que lit la colonne Excel comme la fiche produit. */
  if (!KEEP_HTML && product.description && /<[a-z/!]/i.test(product.description)) {
    const text = htmlToText(product.description)
    if (text && text !== product.description) {
      set.description = text
      changes.push(`description : ${product.description.length} c. de HTML → ${text.length} c. de texte`)
    }
  }

  /* Mode — n'a de sens que sur un appareil qui délivre un choc. */
  if (product.deviceMode && !modeApplies(kind)) {
    unset.deviceMode = 1
    changes.push(`mode « ${product.deviceMode} » retiré (${kind})`)
  }

  /* Traçabilité — elle suit le produit, pas le rayon d'où il vient. */
  const want = expectedTracking(kind)
  for (const [key, label] of [
    ['requiresSerialNumber', 'n° de série'],
    ['requiresLotNumber',    'n° de lot'],
  ]) {
    if (!!product[key] !== want[key]) {
      set[key] = want[key]
      changes.push(`${label} : ${product[key] ? 'oui' : 'non'} → ${want[key] ? 'oui' : 'non'}`)
    }
  }

  return { kind, changes, set, unset }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const [products, categories] = await Promise.all([
    Product.find({}).lean(),
    ProductCategory.find({ isActive: true }).select('name slug').lean(),
  ])

  console.log(`${products.length} produit(s), ${categories.length} catégorie(s) : `
    + categories.map(c => c.name).join(', ') + '\n')

  let touched = 0
  const moved  = []
  const tests  = []

  for (const p of products) {
    if (looksLikeTestRecord(p)) tests.push(p)

    const { kind, changes, set, unset } = planFor(p, categories)
    if (changes.length === 0) continue

    touched++
    console.log(`• ${p.name}  [${kind}]`)
    changes.forEach(c => console.log(`    ${c}`))
    if (set.category) moved.push(p.name)

    if (!DRY) {
      const update = {}
      if (Object.keys(set).length)   update.$set   = set
      if (Object.keys(unset).length) update.$unset = unset
      await Product.updateOne({ _id: p._id }, update)
    }
  }

  console.log(`\n${touched} fiche(s) à corriger sur ${products.length}.`)
  if (moved.length) {
    console.log(`${moved.length} changent de catégorie — vérifiez-les, c'est le correctif`
      + ' le plus visible dans l\'application :')
    moved.forEach(n => console.log(`    ${n}`))
  }

  /* Les saisies d'essai ne sont jamais supprimées : c'est au propriétaire du
     catalogue de dire si « gggg » doit disparaître. */
  if (tests.length) {
    console.log(`\n${tests.length} fiche(s) ressemblent à des saisies d'essai :`)
    tests.forEach(p => console.log(`    « ${p.name} »  réf. ${p.reference || '—'}  marque ${p.brand || '—'}`))
    if (ARCHIVE && !DRY) {
      await Product.updateMany({ _id: { $in: tests.map(p => p._id) } }, { $set: { isActive: false } })
      console.log('    → archivées (restaurables depuis l\'onglet Archivés du stock).')
    } else if (!ARCHIVE) {
      console.log('    Relancez avec --archiver-tests pour les archiver (réversible).')
    }
  }

  console.log(DRY
    ? '\nSimulation terminée — relancez sans --dry pour écrire.'
    : '\nReprise terminée.')
  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
