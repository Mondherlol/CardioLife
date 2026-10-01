const fsp  = require('fs/promises')
const path = require('path')

/**
 * Remise à zéro des données métier.
 *
 * Une seule implémentation pour les deux points d'entrée — le bouton
 * « Réinitialiser » des paramètres et l'import du parc en mode « repartir de
 * zéro » : deux copies finiraient par ne plus effacer la même chose.
 *
 * `User` en est volontairement absent — c'est la seule chose qu'on garde, pour
 * ne pas se retrouver enfermé dehors. `AppSettings` aussi : ce sont les réglages
 * de l'application, pas des données saisies. Le suivi des demandes (`Todo`) ne
 * part que sur demande explicite : c'est l'échange avec le client sur les
 * évolutions de l'appli, pas une donnée du parc.
 */
const RESET_MODELS = [
  'Client', 'Site', 'Contract', 'Intervention', 'Control', 'Formation',
  'Appointment', 'Replacement', 'Document',
  'Product', 'ProductCategory', 'ProductItem', 'StockMovement', 'Pack',
]

/* Dossiers d'uploads liés à ces données : les fichiers n'auraient plus aucun
   enregistrement pour les désigner. `avatars` et `company` restent — ils
   appartiennent aux comptes et aux réglages. */
const RESET_UPLOAD_DIRS = ['clients', 'documents', 'formations', 'interventions', 'products']

const UPLOADS = path.join(__dirname, '..', 'uploads')

async function emptyDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    await fsp.rm(path.join(dir, entry.name), { recursive: true, force: true }).catch(() => {})
  }
}

/* Le catalogue : il peut survivre à la remise à zéro, car il alimente aussi
   les fiches produits du site web public. */
const CATALOG_MODELS = ['Product', 'ProductCategory']

/**
 * Efface les données métier. Rend le nombre de documents supprimés par modèle.
 * `keepFiles` garde les fichiers téléversés ; `wipeTodos` vide aussi le suivi ;
 * `keepCatalog` garde produits, catégories et leurs images — le stock, lui,
 * repart à zéro avec les exemplaires qui le portaient.
 */
async function resetBusinessData({ keepFiles = false, wipeTodos = false, keepCatalog = false } = {}) {
  const deleted = {}
  let names = wipeTodos ? [...RESET_MODELS, 'Todo'] : RESET_MODELS
  if (keepCatalog) names = names.filter(n => !CATALOG_MODELS.includes(n))
  for (const name of names) {
    const { deletedCount } = await require(`../models/${name}`).deleteMany({})
    deleted[name] = deletedCount
  }
  if (keepCatalog) await require('../models/Product').updateMany({}, { $set: { stock: 0 } })

  if (!keepFiles) {
    let dirs = wipeTodos ? [...RESET_UPLOAD_DIRS, 'todos'] : RESET_UPLOAD_DIRS
    if (keepCatalog) dirs = dirs.filter(d => d !== 'products')
    for (const dir of dirs) await emptyDir(path.join(UPLOADS, dir))
  }

  // Le dossier d'upload par défaut désignait peut-être un dossier effacé.
  await require('../models/AppSettings').updateMany({}, { $set: { defaultUploadFolderId: null } })

  // Les catégories du catalogue sont recréées d'office : sans elles, le stock
  // et l'import du parc n'ont nulle part où ranger un produit.
  await require('../controllers/productCategoriesController').seedIfEmpty()

  return deleted
}

module.exports = { resetBusinessData, RESET_MODELS, RESET_UPLOAD_DIRS }
