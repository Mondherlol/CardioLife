/**
 * Reprise : éclate les lignes de stock qui portent plusieurs unités.
 *
 * La réception crée désormais une ligne par pièce, y compris pour les articles
 * suivis par lot. Les lignes reçues avant ce changement portaient la quantité
 * (« LOT-2026-001 × 5 ») : impossible d'y suivre le statut, l'appareil ou la
 * sortie de chaque unité. Cette reprise les découpe à l'identique — même lot,
 * même DLC, même fournisseur, même date d'entrée.
 *
 * Le total en stock ne bouge pas : cinq unités sur une ligne deviennent cinq
 * lignes d'une unité. Aucun mouvement de stock n'est écrit — rien n'entre ni ne
 * sort, c'est la même marchandise, présentée autrement. L'historique reste sur
 * la ligne d'origine : le recopier ferait croire à autant d'entrées en stock
 * qu'il y a de pièces.
 *
 * Idempotent — relançable sans risque : une fois éclatées, les lignes portent
 * une seule unité et ne sont plus reprises.
 *
 * La même reprise est disponible sans terminal, dans Paramètres › Dev Fix.
 * Elle partage cette implémentation : `utils/maintenance.js`.
 *
 * Usage : node scripts/splitStockLots.js [--dry]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const { splitStockLots } = require('../utils/maintenance')

const DRY = process.argv.includes('--dry')

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const report = await splitStockLots({ dry: DRY })
  console.log(`${report.totals.lines} ligne(s) de stock portant plusieurs unités.\n`)

  for (const l of report.lines) {
    console.log(`${DRY ? '·' : '✓'} ${l.product} · ${l.lotNumber} — ${l.before} unités → +${l.created} ligne(s)`)
  }

  console.log(
    `\n${report.totals.created} ligne(s) ${DRY ? 'à créer' : 'créée(s)'}.`
    + (DRY ? '\nMode simulation : rien n\'a été écrit. Relancez sans --dry pour appliquer.' : '')
  )

  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
