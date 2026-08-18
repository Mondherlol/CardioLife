/**
 * Retire des fiches produits créées par erreur — typiquement un import Excel
 * lancé sur la mauvaise base.
 *
 * Ne vise que les fiches **créées** dans la fenêtre indiquée. Un import met
 * aussi à jour des fiches qui existaient avant : celles-là ont un `createdAt`
 * antérieur, elles ne sont donc jamais touchées. L'import n'écrase pas les
 * champs laissés vides, leur contenu d'origine est intact.
 *
 * Rien n'est supprimé sans `--confirmer` : par défaut le script se contente de
 * montrer ce qu'il ferait. C'est l'inverse de la convention des autres scripts,
 * et c'est voulu — une suppression définitive sur une base client ne doit pas
 * pouvoir partir d'une faute de frappe.
 *
 * Une fiche déjà engagée dans le métier n'est jamais supprimée, même avec
 * `--confirmer` : appareil posé chez un client, exemplaire réservé, pack ou
 * demande de remplacement qui la cite. Elle est signalée, et reste là.
 *
 * Usage :
 *   node scripts/removeImportedProducts.js --depuis 2h
 *   node scripts/removeImportedProducts.js --depuis "2026-08-18 22:00" --jusqua "2026-08-18 23:30"
 *   node scripts/removeImportedProducts.js --depuis 2h --auteur mondher
 *   node scripts/removeImportedProducts.js --ids 6a0e13ff...,6a0ef1f8...
 *   node scripts/removeImportedProducts.js --depuis 2h --confirmer     ← écrit
 */

require('dotenv').config()
const mongoose = require('mongoose')
const path     = require('path')
const fs       = require('fs')

const Product       = require('../models/Product')
const ProductItem   = require('../models/ProductItem')
const StockMovement = require('../models/StockMovement')
const Site          = require('../models/Site')
const Pack          = require('../models/Pack')
const Replacement   = require('../models/Replacement')
const User          = require('../models/User')

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products')

/* ── Arguments ────────────────────────────────────────────────── */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}
const CONFIRM = process.argv.includes('--confirmer')

/** « 90m », « 2h », « 3j » comptés depuis maintenant, ou une date absolue. */
function parseWhen(value, label) {
  if (!value) return null
  const rel = String(value).match(/^(\d+)\s*(m|min|h|j|d)$/i)
  if (rel) {
    const n = Number(rel[1])
    const ms = { m: 60e3, min: 60e3, h: 3600e3, j: 86400e3, d: 86400e3 }[rel[2].toLowerCase()]
    return new Date(Date.now() - n * ms)
  }
  const d = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) {
    console.error(`Date illisible pour --${label} : « ${value} ».`)
    console.error('Attendu : « 2h », « 90m », « 3j », ou « 2026-08-18 22:00 ».')
    process.exit(1)
  }
  return d
}

const fmt = d => (d ? new Date(d).toLocaleString('fr-FR') : '—')

/* ── Ce qui retient une fiche ─────────────────────────────────── */

/**
 * Attaches qui interdisent la suppression.
 *
 * Le stock et les mouvements ne comptent pas : ce sont les écritures de la
 * fiche elle-même, elles partent avec elle. Ce qui retient, c'est le métier —
 * un appareil posé, un exemplaire promis, un pack ou une demande qui la cite.
 */
async function blockers(productId) {
  const [parc, engaged, packs, replacements] = await Promise.all([
    Site.countDocuments({
      $or: [
        { 'deas.product': productId },
        { 'deas.electrodes.product': productId },
        { 'deas.batteries.product': productId },
      ],
    }),
    ProductItem.countDocuments({
      product: productId,
      $or: [
        { status: { $in: ['installe', 'reserve'] } },
        { dea:    { $ne: null } },
        { client: { $ne: null } },
      ],
    }),
    Pack.countDocuments({ 'products.product': productId }),
    Replacement.countDocuments({ product: productId }),
  ])

  const out = []
  if (parc)         out.push(`${parc} site(s) l'utilisent dans leur parc`)
  if (engaged)      out.push(`${engaged} exemplaire(s) posé(s) ou réservé(s)`)
  if (packs)        out.push(`${packs} pack(s) la citent`)
  if (replacements) out.push(`${replacements} demande(s) de remplacement`)
  return out
}

/* ── Sélection ────────────────────────────────────────────────── */

async function select() {
  const ids = arg('ids')
  if (ids) {
    const list = ids.split(',').map(s => s.trim()).filter(Boolean)
    const bad  = list.filter(id => !mongoose.isValidObjectId(id))
    if (bad.length) { console.error(`Identifiant invalide : ${bad.join(', ')}`); process.exit(1) }
    return { products: await Product.find({ _id: { $in: list } }).lean(), how: `${list.length} identifiant(s)` }
  }

  const since = parseWhen(arg('depuis'), 'depuis')
  const until = parseWhen(arg('jusqua'), 'jusqua')
  if (!since) {
    console.error('Indiquez la fenêtre de création : --depuis 2h, ou --depuis "2026-08-18 22:00".')
    console.error('À défaut, --ids <id1,id2> cible des fiches précises.')
    process.exit(1)
  }

  const filter = { createdAt: { $gte: since } }
  if (until) filter.createdAt.$lte = until

  let how = `créées depuis le ${fmt(since)}${until ? ` jusqu'au ${fmt(until)}` : ''}`

  const author = arg('auteur')
  if (author) {
    const user = await User.findOne({
      $or: [{ username: author }, { fullName: author }],
    }).select('_id username fullName')
    if (!user) { console.error(`Aucun utilisateur « ${author} ».`); process.exit(1) }
    filter.createdBy = user._id
    how += `, par ${user.fullName || user.username}`
  }

  return { products: await Product.find(filter).sort({ createdAt: 1 }).lean(), how }
}

/* ── Exécution ────────────────────────────────────────────────── */

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const total = await Product.countDocuments()
  const { products, how } = await select()

  console.log(`Base : ${total} produit(s) au total.`)
  console.log(`Sélection : ${products.length} fiche(s) ${how}.\n`)

  if (products.length === 0) {
    console.log('Rien à retirer. Élargissez la fenêtre avec --depuis, ou visez des --ids.')
    return mongoose.disconnect()
  }

  /* Garde-fou : si la sélection ratisse tout le catalogue, la fenêtre est
     probablement trop large — mieux vaut le dire avant d'écrire. */
  if (!CONFIRM && products.length === total && total > 1) {
    console.log('⚠  La sélection couvre TOUT le catalogue. Resserrez --depuis / --jusqua'
      + ' avant de confirmer.\n')
  }

  const removable = []
  const kept      = []

  for (const p of products) {
    const [items, moves, why] = await Promise.all([
      ProductItem.countDocuments({ product: p._id }),
      StockMovement.countDocuments({ product: p._id }),
      blockers(p._id),
    ])
    const author = p.createdBy
      ? await User.findById(p.createdBy).select('username fullName').lean()
      : null

    const row = { p, items, moves, why, author }
    if (why.length) kept.push(row); else removable.push(row)
  }

  console.log(`— À supprimer : ${removable.length} —`)
  for (const { p, items, moves, author } of removable) {
    console.log(`  • ${p.name}  [${p.category}]`)
    console.log(`      créée le ${fmt(p.createdAt)}`
      + `${author ? ` par ${author.fullName || author.username}` : ''}`
      + `${p.reference ? ` · réf. ${p.reference}` : ''}`)
    const bits = []
    if (items) bits.push(`${items} article(s) de stock`)
    if (moves) bits.push(`${moves} mouvement(s)`)
    if (p.images?.length) bits.push(`${p.images.length} image(s)`)
    if (bits.length) console.log(`      emporte : ${bits.join(', ')}`)
  }

  if (kept.length) {
    console.log(`\n— Conservées : ${kept.length} (engagées dans le métier) —`)
    for (const { p, why } of kept) {
      console.log(`  • ${p.name}`)
      why.forEach(w => console.log(`      ${w}`))
    }
    console.log('  Ces fiches ne seront pas supprimées : les retirer casserait le parc.')
    console.log('  Si elles doivent partir, détachez-les d\'abord depuis l\'application.')
  }

  if (!CONFIRM) {
    console.log(`\nSimulation — rien n'a été écrit.`)
    console.log(`Relancez la MÊME commande avec --confirmer pour supprimer les ${removable.length} fiche(s).`)
    return mongoose.disconnect()
  }

  if (removable.length === 0) {
    console.log('\nAucune fiche supprimable.')
    return mongoose.disconnect()
  }

  console.log('\nSuppression…')
  let files = 0
  for (const { p } of removable) {
    await ProductItem.deleteMany({ product: p._id })
    await StockMovement.deleteMany({ product: p._id })
    for (const img of p.images || []) {
      const full = path.join(UPLOAD_DIR, path.basename(img))
      if (fs.existsSync(full)) { fs.unlinkSync(full); files++ }
    }
    await Product.deleteOne({ _id: p._id })
    console.log(`  supprimée : ${p.name}`)
  }

  console.log(`\n${removable.length} fiche(s) supprimée(s), ${files} fichier(s) image retiré(s).`)
  if (kept.length) console.log(`${kept.length} conservée(s).`)
  console.log(`Reste ${await Product.countDocuments()} produit(s) au catalogue.`)

  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
