/**
 * Remet la base à zéro pour repartir sur des tests propres.
 *
 * Conserve : users, products (stock remis à 0), productcategories, appsettings,
 * et le squelette GED (documents `isSystem`).
 * Supprime : clients, sites, contrats, contrôles, interventions, formations,
 * rendez-vous, exemplaires de stock, mouvements de stock, packs, fichiers GED.
 *
 * Tout ce qui est supprimé est d'abord dumpé en JSON dans le dossier de
 * sauvegarde, et le script refuse de tourner sur autre chose qu'une base locale.
 *
 * Usage : node scripts/resetTestDb.js <dossier-sauvegarde> [--apply]
 * Sans --apply, c'est un dry-run : il affiche ce qu'il ferait, sans rien toucher.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const fs       = require('fs')
const path     = require('path')
const mongoose = require('mongoose')

const BACKUP_DIR = process.argv[2]
const APPLY      = process.argv.includes('--apply')

/* Vidées intégralement. */
const WIPE = [
  'appointments', 'clients', 'contracts', 'controls',
  'formations', 'interventions', 'sites', 'stockmovements', 'productitems', 'packs',
]
/* Collections mortes : leurs modèles n'existent plus dans le code. */
const DROP = ['clienttypes', 'installations']
/* Conservées telles quelles. */
const KEEP = ['users', 'products', 'productcategories', 'appsettings']

async function main() {
  if (!BACKUP_DIR) throw new Error('Usage : node scripts/resetTestDb.js <dossier-sauvegarde> [--apply]')

  await mongoose.connect(process.env.MONGODB_URI)
  const db = mongoose.connection.db

  // Garde-fou : jamais sur une base distante.
  const host = mongoose.connection.host
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`Refus : la base ciblée n'est pas locale (${host})`)
  }
  console.log(`Base : ${mongoose.connection.name} @ ${host}`)
  console.log(APPLY ? '=== MODE APPLY ===' : '=== DRY-RUN (ajouter --apply pour exécuter) ===')

  const existing = (await db.listCollections().toArray()).map(c => c.name)
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  const dump = async (name, filter = {}) => {
    const docs = await db.collection(name).find(filter).toArray()
    fs.writeFileSync(path.join(BACKUP_DIR, `${name}.json`), JSON.stringify(docs, null, 2))
    return docs.length
  }

  for (const name of [...WIPE, ...DROP]) {
    if (!existing.includes(name)) { console.log(`  –      ${name} (absente)`); continue }
    const n = await dump(name)
    if (APPLY) {
      if (DROP.includes(name)) await db.collection(name).drop()
      else await db.collection(name).deleteMany({})
    }
    console.log(`  ${DROP.includes(name) ? 'DROP  ' : 'VIDE  '} ${name.padEnd(16)} ${n} doc(s)`)
  }

  // GED : on ne garde que le squelette système (dossier « Clients », etc.),
  // sinon l'arborescence attendue par l'appli disparaît.
  const docsCol  = db.collection('documents')
  const toDelete = { isSystem: { $ne: true } }
  const n    = await dump('documents', toDelete)
  const kept = await docsCol.countDocuments({ isSystem: true })
  if (APPLY) await docsCol.deleteMany(toDelete)
  console.log(`  VIDE   ${'documents'.padEnd(16)} ${n} supprimé(s), ${kept} dossier(s) système gardé(s)`)

  // Stock des modèles à zéro (les exemplaires qui le portaient ont disparu).
  const prods = await db.collection('products').countDocuments()
  if (APPLY) await db.collection('products').updateMany({}, { $set: { stock: 0 } })
  console.log(`  STOCK  ${'products'.padEnd(16)} ${prods} modèle(s) → stock = 0`)

  // Le dossier d'upload par défaut pointait peut-être sur un dossier supprimé.
  const settings = await db.collection('appsettings').findOne({})
  if (settings?.defaultUploadFolderId) {
    const stillThere = await docsCol.countDocuments({ _id: settings.defaultUploadFolderId, isSystem: true })
    if (!stillThere) {
      if (APPLY) await db.collection('appsettings').updateMany({}, { $set: { defaultUploadFolderId: null } })
      console.log('  FIX    appsettings.defaultUploadFolderId → null (dossier supprimé)')
    }
  }

  console.log(`\nConservées : ${KEEP.join(', ')}`)
  console.log(`Sauvegarde : ${BACKUP_DIR}`)
  await mongoose.disconnect()
}

main().catch(e => { console.error('ERREUR :', e.message); process.exit(1) })
