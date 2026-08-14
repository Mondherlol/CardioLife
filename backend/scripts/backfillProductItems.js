/**
 * Reprise : matérialise la collection `productitems` à partir de l'existant.
 *
 * Jusqu'ici un exemplaire n'existait que sous forme de chaîne dans les
 * `serialNumbers[]` des mouvements de stock, ou dans le `serialNumber` d'un DEA
 * posé. Ce script reconstitue un article par exemplaire, pour chaque produit
 * actif de chaque catégorie :
 *
 *   1. les numéros de série entrés puis non sortis   → article « disponible »
 *   2. les lots entrés avec un reliquat positif       → article de lot (quantity)
 *   3. le solde non tracé du produit                  → une ligne anonyme
 *   4. les DEA du parc portant un numéro de série     → article « installé »
 *
 * Enfin `Product.stock` est réaligné sur la somme des articles.
 *
 * Idempotent : un numéro de série (ou un lot) déjà présent n'est pas recréé.
 *
 * Usage : node scripts/backfillProductItems.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')
const ProductItem     = require('../models/ProductItem')
const StockMovement   = require('../models/StockMovement')
const Site            = require('../models/Site')
const { syncProductStock } = require('../utils/productItems')

const DRY = process.argv.includes('--dry')

function log(...args) { console.log(...args) }

/* Numéros de série encore en stock, et lots avec leur reliquat. */
function digestMovements(movements) {
  const entered = new Map()   // série → date d'entrée
  const exited  = new Set()
  const lots    = new Map()   // n° de lot → { quantity, expirationDate, entryDate }

  for (const mv of movements) {
    if (mv.type === 'entree' || mv.type === 'serialisation') {
      for (const sn of mv.serialNumbers || []) if (!entered.has(sn)) entered.set(sn, mv.createdAt)
    }
    if (mv.type === 'sortie') {
      for (const sn of mv.serialNumbers || []) exited.add(sn)
    }
    if (mv.lotNumber) {
      const l = lots.get(mv.lotNumber) || { quantity: 0, expirationDate: null, entryDate: mv.createdAt }
      if (mv.type === 'entree') {
        l.quantity += mv.quantity || 0
        if (mv.expirationDate) l.expirationDate = mv.expirationDate
      } else if (mv.type === 'sortie') {
        l.quantity -= mv.quantity || 0
      }
      lots.set(mv.lotNumber, l)
    }
  }

  return {
    serials: [...entered.entries()].filter(([sn]) => !exited.has(sn)),
    lots:    [...lots.entries()].filter(([, l]) => l.quantity > 0),
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
  log(DRY ? '— Simulation (--dry), rien ne sera écrit —\n' : '— Reprise des articles —\n')

  // Tous les produits sont tenus à l'article, quelle que soit leur catégorie :
  // l'onglet Articles est désormais la seule vue du stock d'un produit.
  const cats = await ProductCategory.find({ isActive: true }).select('slug name')
  if (cats.length === 0) {
    log('Aucune catégorie de produits.')
    return mongoose.disconnect()
  }
  log(`Catégories : ${cats.map(c => c.name).join(', ')}\n`)

  const slugs = cats.map(c => c.slug)
  // Les produits archivés gardent parfois un stock résiduel : les reprendre
  // ferait apparaître des articles pour des modèles retirés du catalogue.
  const products = await Product.find({ category: { $in: slugs }, isActive: true })

  let createdSerial = 0, createdLot = 0, createdAnon = 0, linkedDeas = 0, createdFromDea = 0

  for (const product of products) {
    const movements = await StockMovement.find({ product: product._id }).sort({ createdAt: 1 })
    const { serials, lots } = digestMovements(movements)

    const existing = await ProductItem.find({ product: product._id }).select('serialNumber lotNumber quantity status')
    const knownSerials = new Set(existing.map(i => i.serialNumber).filter(Boolean))
    const knownLots    = new Set(existing.map(i => i.lotNumber).filter(Boolean))

    const docs = []

    for (const [sn, entryDate] of serials) {
      if (knownSerials.has(sn)) continue
      docs.push({
        product: product._id, category: product.category,
        reference: product.reference || '', supplier: product.supplier || '',
        serialNumber: sn, quantity: 1, status: 'disponible',
        entryDate: entryDate || product.createdAt,
        history: [{ action: 'Reprise de l\'historique de stock', to: 'disponible', date: entryDate || product.createdAt }],
      })
      createdSerial++
    }

    for (const [lotNumber, l] of lots) {
      if (knownLots.has(lotNumber)) continue
      docs.push({
        product: product._id, category: product.category,
        reference: product.reference || '', supplier: product.supplier || '',
        lotNumber, quantity: l.quantity, expirationDate: l.expirationDate || undefined,
        status: 'disponible', entryDate: l.entryDate || product.createdAt,
        history: [{ action: 'Reprise de l\'historique de stock', to: 'disponible', date: l.entryDate || product.createdAt }],
      })
      createdLot++
    }

    // Solde non tracé : le stock déclaré que ni les séries ni les lots
    // n'expliquent. Une ligne anonyme le rend visible, à détailler à la main.
    const covered = docs.reduce((n, d) => n + (d.quantity || 1), 0)
      + existing.filter(i => ['disponible', 'reserve', 'maintenance'].includes(i.status))
                .reduce((n, i) => n + (i.quantity ?? 1), 0)
    const rest = (product.stock || 0) - covered
    if (rest > 0) {
      docs.push({
        product: product._id, category: product.category,
        reference: product.reference || '', supplier: product.supplier || '',
        quantity: rest, status: 'disponible', entryDate: product.createdAt,
        notes: 'Reprise : unités sans numéro de série ni lot connu.',
        history: [{ action: 'Reprise du solde de stock', to: 'disponible', date: product.createdAt }],
      })
      createdAnon += rest
    }

    if (docs.length) {
      log(`  ${product.name} — ${docs.length} ligne(s)`)
      if (!DRY) await ProductItem.insertMany(docs)
    }
  }

  // ── Parc : les DEA posés portent le même numéro de série que le stock ──
  const sites = await Site.find({ isActive: true })
  for (const site of sites) {
    for (const dea of site.deas) {
      const sn = String(dea.serialNumber || '').trim()
      if (!sn) continue

      const query = { serialNumber: sn }
      if (dea.product) query.product = dea.product
      const item = await ProductItem.findOne(query)
      if (item && String(item.dea || '') === String(dea._id)) continue

      const status = dea.status === 'installe' ? 'installe' : 'reserve'

      if (item) {
        log(`  DEA ${sn} → ${site.name} (${status})`)
        if (!DRY) {
          item.dea = dea._id; item.site = site._id; item.client = site.client
          item.status = status
          item.history.push({ action: 'Reprise : rattaché au parc', to: status, note: site.name, date: dea.installationDate || new Date() })
          await item.save()
        }
        linkedDeas++
        continue
      }

      // Appareil posé avant l'arrivée des articles : il n'a jamais transité par
      // le stock. On lui crée sa fiche directement à l'état « installé » — hors
      // stock, donc sans effet sur les compteurs du modèle.
      if (!dea.product) {
        log(`  DEA ${sn} → ${site.name} : ignoré, aucun modèle rattaché`)
        continue
      }
      const product = products.find(p => String(p._id) === String(dea.product))
        || await Product.findById(dea.product)
      if (!product || !slugs.includes(product.category)) continue

      log(`  DEA ${sn} → ${site.name} : article créé (${status})`)
      if (!DRY) {
        await ProductItem.create({
          product:      product._id,
          category:     product.category,
          reference:    product.reference || '',
          supplier:     product.supplier  || '',
          serialNumber: sn,
          quantity:     1,
          status,
          entryDate:    dea.installationDate || dea.createdAt,
          site:         site._id,
          client:       site.client,
          dea:          dea._id,
          notes:        'Reprise : appareil déjà posé, jamais passé par le stock.',
          history:      [{ action: 'Reprise : appareil du parc', to: status, note: site.name, date: dea.installationDate || new Date() }],
        })
      }
      createdFromDea++
    }
  }

  if (!DRY) {
    for (const product of products) await syncProductStock(product._id)
  }

  log(`\n${createdSerial} article(s) sérialisé(s), ${createdLot} lot(s), ${createdAnon} unité(s) anonyme(s),`)
  log(`${linkedDeas} DEA rattaché(s) à un article existant, ${createdFromDea} article(s) créé(s) depuis le parc.`)
  log(DRY ? 'Simulation terminée — relancez sans --dry pour écrire.' : 'Reprise terminée.')
  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
