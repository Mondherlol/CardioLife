const mongoose        = require('mongoose')
const ProductItem     = require('../models/ProductItem')
const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')

const { IN_STOCK_STATUSES } = ProductItem

const DAY = 86400000

/**
 * Les catégories qui s'ouvrent sur la liste de leurs modèles dans le stock,
 * au lieu de la grille de tuiles. Ce réglage ne concerne plus que l'affichage :
 * tous les produits, quelle que soit leur catégorie, sont tenus à l'article.
 */
async function modelViewSlugs() {
  const cats = await ProductCategory.find({ isActive: true, tracksItems: true }).select('slug')
  return cats.map(c => c.slug)
}

/**
 * Agrège une liste d'articles en les compteurs de la barre du haut.
 *
 * « Disponible » retire aussi le matériel en atelier : réservé et en
 * maintenance sont tous deux indisponibles à la vente, les additionner
 * reviendrait à compter deux fois le même appareil.
 */
function summarize(items = [], { expirySoonDays = 90 } = {}) {
  const now  = Date.now()
  const soon = now + expirySoonDays * DAY

  const s = {
    total: 0, disponible: 0, reserve: 0, maintenance: 0,
    vendu: 0, installe: 0, hs: 0,
    expired: 0, expiringSoon: 0, nextExpiry: null,
  }

  for (const it of items) {
    const qty = it.quantity ?? 1
    s[it.status] = (s[it.status] || 0) + qty
    if (IN_STOCK_STATUSES.includes(it.status)) {
      s.total += qty
      if (it.expirationDate) {
        const t = new Date(it.expirationDate).getTime()
        if (t < now)       s.expired      += qty
        else if (t <= soon) s.expiringSoon += qty
        if (s.nextExpiry == null || t < s.nextExpiry) s.nextExpiry = t
      }
    }
  }

  // `disponible` sort déjà de la boucle : total − réservé − maintenance.
  s.nextExpiry = s.nextExpiry ? new Date(s.nextExpiry) : null
  return s
}

/**
 * Réaligne `Product.stock` sur la somme des articles en stock. Les articles
 * sont la source de vérité pour les catégories à suivi unitaire ; le compteur
 * du produit reste maintenu en miroir pour le tableau de bord, les contrats et
 * le widget de stock, qui le lisent directement.
 */
async function syncProductStock(productId) {
  if (!mongoose.isValidObjectId(productId)) return null

  const [agg] = await ProductItem.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), status: { $in: IN_STOCK_STATUSES } } },
    { $group: { _id: null, n: { $sum: { $ifNull: ['$quantity', 1] } } } },
  ])
  const stock = agg?.n || 0

  return Product.findByIdAndUpdate(productId, { $set: { stock } }, { new: true })
}

/** Ajoute une ligne au journal de vie et enregistre. */
async function logHistory(item, { action, from, to, note, user }) {
  item.history.push({ action, from, to, note, user, date: new Date() })
  return item.save()
}

/**
 * Retrouve l'article correspondant à un DEA du parc. On tente d'abord le lien
 * explicite, puis le numéro de série sur le bon modèle — c'est ce second cas
 * qui rattache les appareils posés avant l'arrivée des articles.
 */
async function findItemForDea(deaId, { product, serialNumber } = {}) {
  if (deaId && mongoose.isValidObjectId(deaId)) {
    /* Le DAE porte aussi ses consommables : sans filtrer sur le modèle, on
       ramènerait une batterie là où l'appareil est attendu. */
    const linked = await ProductItem.findOne(
      product && mongoose.isValidObjectId(product) ? { dea: deaId, product } : { dea: deaId }
    )
    if (linked) return linked
  }
  const sn = String(serialNumber || '').trim()
  if (!sn) return null
  const query = { serialNumber: sn }
  if (product && mongoose.isValidObjectId(product)) query.product = product
  return ProductItem.findOne(query)
}

/**
 * Rattache le DEA à l'exemplaire de stock qui porte le même numéro de série.
 * C'est le pont entre le stock et le parc : une fois posé, l'appareil sort du
 * stock et sa fiche article pointe vers le client et le site.
 *
 * Sans exemplaire correspondant (parc saisi avant le stock, import initial),
 * l'appel ne fait rien.
 */
async function syncDeaWithItem(site, dea) {
  const item = await findItemForDea(dea._id, { product: dea.product, serialNumber: dea.serialNumber })
  if (!item) return

  const wasInStock = IN_STOCK_STATUSES.includes(item.status)
  const from       = item.status

  item.dea    = dea._id
  item.site   = site._id
  item.client = site.client
  // Un appareil seulement planifié reste réservé : il est encore à l'entrepôt.
  item.status = dea.status === 'installe' ? 'installe' : 'reserve'

  if (item.status === 'reserve') {
    item.reservedFor = { client: site.client, note: `Pose planifiée — ${site.name}` }
  } else {
    item.reservedFor = undefined
  }

  if (from !== item.status) {
    await logHistory(item, {
      action: item.status === 'installe' ? 'Installé chez le client' : 'Réservé pour une pose',
      from, to: item.status, note: site.name,
    })
  } else {
    await item.save()
  }

  if (wasInStock && !IN_STOCK_STATUSES.includes(item.status)) await syncProductStock(item.product)
}

const numbered = x => !!(x?.serialNumber || x?.lotNumber)

/**
 * Une ligne du parc et un article de stock désignent-ils la même pièce ?
 *
 * Par son numéro quand il y en a un. Une pièce reprise d'un fichier n'en a
 * pas : sur un même DAE, c'est alors le modèle qui l'identifie.
 */
function samePiece(line, item) {
  if (String(line.product || '') !== String(item.product || '')) return false
  if (line.serialNumber && item.serialNumber) return line.serialNumber === item.serialNumber
  if (line.lotNumber && item.lotNumber)       return line.lotNumber === item.lotNumber
  return !numbered(line) && !numbered(item)
}

/**
 * Apparie les lignes d'un DAE aux articles qui y sont rattachés, une pièce par
 * ligne. Rend les paires et les articles restés sans ligne.
 */
function pairPieces(lines, items) {
  const free  = [...items]
  const pairs = []
  for (const line of lines) {
    const idx = free.findIndex(item => samePiece(line, item))
    if (idx >= 0) pairs.push({ line, item: free.splice(idx, 1)[0] })
  }
  return { pairs, free }
}

/**
 * Sort du parc un article qui n'est plus monté.
 *
 * Une pièce numérotée retourne au stock, d'où on peut la remonter ailleurs.
 * Une pièce sans numéro — reprise d'un fichier — ne se distingue pas d'une
 * neuve : la remettre « disponible » ferait compter une batterie usée ou
 * périmée comme du stock. Elle passe hors service.
 */
async function unmountItem(item, { action, hsAction = action, note } = {}) {
  const from = item.status
  const to   = numbered(item) ? 'disponible' : 'hs'
  item.dea = undefined; item.site = undefined; item.client = undefined
  item.reservedFor = undefined
  item.activationDate = undefined
  item.status = to
  await logHistory(item, {
    action: to === 'hs' ? `${hsAction} — pièce sans n°, mise hors service` : action,
    from, to, note,
  })
  await syncProductStock(item.product)
}

/**
 * Détache une unité d'un article de stock qui en porte plusieurs.
 *
 * Les réceptions créent une ligne par pièce, mais un lot entré avant ce
 * changement peut encore en porter cinq : on ne va pas sortir les cinq du stock
 * parce qu'une seule est montée sur un DAE.
 */
async function takeOneUnit(item) {
  if ((item.quantity ?? 1) <= 1) return item

  const copy = item.toObject()
  delete copy._id
  delete copy.createdAt
  delete copy.updatedAt
  copy.quantity = 1
  copy.history  = [{ action: 'Unité détachée du lot', to: item.status, date: new Date() }]

  const [unit] = await ProductItem.insertMany([copy])
  item.quantity -= 1
  await item.save()
  return unit
}

/**
 * Aligne le stock sur les consommables déclarés d'un DAE.
 *
 * Déclarer la batterie montée sur un appareil, c'est la sortir du stock : elle
 * est chez le client, pas à l'entrepôt. Sans ce pont, la liste des articles
 * continuait d'annoncer cinq batteries disponibles alors que l'une d'elles
 * était posée — et personne ne savait chez qui.
 *
 * Le mouvement va dans les deux sens : une pièce retirée de la fiche du DAE
 * retourne au stock. Une pièce absente du stock (parc repris, saisie
 * antérieure) ne bloque rien : il n'y a simplement rien à décompter.
 *
 * `kind` vaut 'batteries' ou 'electrodes' — c'est aussi le slug de la catégorie
 * du catalogue, qui distingue ces articles de l'appareil lui-même.
 */
async function syncDeaConsumables(site, dea, kind) {
  const lines    = (dea[kind] || []).filter(l => l.product)
  const attached = await ProductItem.find({ dea: dea._id, category: kind })
  const { pairs, free } = pairPieces(lines, attached)

  // 1. Ce qui n'est plus déclaré sur l'appareil quitte le parc.
  for (const item of free) {
    /* Une pièce déclarée hors service ne revient pas au stock parce qu'elle a
       quitté la fiche du DAE : elle est cassée, pas rangée. */
    if (!IN_STOCK_STATUSES.includes(item.status) && item.status !== 'installe') continue
    await unmountItem(item, {
      action: 'Retour en stock (retirée du DAE)', hsAction: 'Remplacée ou retirée du DAE', note: site.name,
    })
  }

  // 2. Ce qui vient d'être déclaré sort du stock, une unité par ligne.
  for (const line of lines) {
    const already = pairs.find(p => p.line === line)?.item
    if (!already && !numbered(line)) continue   // pièce sans n° : rien à prendre au stock
    if (already) {
      /* La pièce montée et sa fiche article sont le même objet : ce que le
         terrain corrige sur le DAE — péremption relevée sur l'étiquette, date
         de mise en service — doit se lire à l'identique dans le stock. Sans
         ça, la fiche produit annonçait encore la date de la réception. */
      const time = d => (d ? new Date(d).getTime() : null)
      let touched = false

      if (time(line.activationDate) !== time(already.activationDate)) {
        already.activationDate = line.activationDate || undefined
        touched = true
      }
      // Une péremption effacée sur le DAE ne vide pas celle de l'article : on
      // ne perd pas une donnée du stock sur une case laissée vide.
      if (line.expiryDate && time(line.expiryDate) !== time(already.expirationDate)) {
        already.expirationDate = line.expiryDate
        touched = true
      }

      if (touched) await already.save()
      continue
    }

    const query = {
      product:  line.product,
      status:   { $in: IN_STOCK_STATUSES },
      dea:      null,
      ...(line.serialNumber ? { serialNumber: line.serialNumber } : { lotNumber: line.lotNumber }),
    }
    // La DLC la plus proche part la première.
    const found = await ProductItem.findOne(query).sort({ expirationDate: 1, entryDate: 1 })
    if (!found) continue

    const unit = await takeOneUnit(found)
    const from = unit.status
    unit.dea    = dea._id
    unit.site   = site._id
    unit.client = site.client
    unit.status = 'installe'
    unit.reservedFor = undefined
    // La mise en service se saisit sur la fiche du DAE : le stock la recopie
    // plutôt que d'inventer une date de pose.
    if (line.activationDate) unit.activationDate = line.activationDate
    await logHistory(unit, {
      action: 'Montée sur un DAE',
      from, to: 'installe',
      note: [site.name, dea.deviceType || dea.serialNumber].filter(Boolean).join(' · '),
    })
    await syncProductStock(unit.product)
  }
}

/* Les catégories qui se montent sur un DAE — ce sont aussi les noms des listes
   correspondantes dans `Site.deas`. */
const CONSUMABLE_LISTS = ['batteries', 'electrodes']

/**
 * Détache du parc un article qui rentre à l'entrepôt.
 *
 * Remettre une pièce en stock depuis la fiche produit, c'est dire qu'elle n'est
 * plus chez le client. La fiche client doit le refléter : sans ça, le même
 * appareil s'affichait à la fois disponible au magasin et posé chez le client,
 * et le prochain technicien partait le contrôler.
 *
 * Deux cas, deux gestes :
 *  — un consommable quitte la liste de son DAE ;
 *  — un défibrillateur quitte le parc du site, comme le ferait « Retirer ce
 *    DEA » depuis la fiche client. Le calendrier des contrôles se réaligne.
 *
 * Retourne ce qui a été retiré, pour la trace.
 */
async function detachItemFromParc(item, { userId } = {}) {
  if (!item?.dea) return null

  const Site = require('../models/Site')
  const site = await Site.findOne({ 'deas._id': item.dea })
  const dea  = site?.deas?.id(item.dea)
  if (!dea) return null

  /* L'article est-il l'appareil lui-même, ou une pièce montée dessus ? Le
     numéro de série tranche, le modèle sert de repli. */
  const isDevice = (item.serialNumber && item.serialNumber === dea.serialNumber)
    || (dea.product && String(dea.product) === String(item.product) && !CONSUMABLE_LISTS.includes(item.category))

  if (isDevice) {
    const label = dea.deviceType || dea.serialNumber || 'DAE'
    dea.deleteOne()
    await site.save()
    // Plus d'appareil, plus de calendrier : les visites du site se réalignent.
    try {
      const { syncSiteControls } = require('./controls')
      await syncSiteControls(site._id, userId)
    } catch (err) {
      console.error('Calendrier du site non réaligné :', err.message)
    }
    return { kind: 'dae', label, site }
  }

  // L'armoire du DAE : elle quitte la fiche de l'appareil avec son article.
  if (item.category === ARMOIRE_CATEGORY) {
    if (!dea.armoire || String(dea.armoire.product || '') !== String(item.product)) return null
    const label = dea.armoire.model || 'Armoire'
    dea.armoire = undefined
    await site.save()
    return { kind: 'armoire', label, site }
  }

  const list = CONSUMABLE_LISTS.find(k => k === item.category)
  if (!list) return null
  // Pièce sans numéro : la ligne du même modèle.
  const idx = (dea[list] || []).findIndex(l => samePiece(l, item))
  if (idx === -1) return null

  const [removed] = dea[list].splice(idx, 1)
  await site.save()
  return { kind: list, label: removed.productName || item.serialNumber || item.lotNumber, site }
}

const ARMOIRE_CATEGORY = 'armoires'

/**
 * Articles des pièces montées sur un DAE — batteries, électrodes, armoire —
 * qui n'en ont pas encore : la pièce est chez le client, sa fiche produit doit
 * la compter. Une pièce reprise d'un fichier n'est jamais passée par le stock :
 * l'article naît directement « installé », rattaché au DAE, au site et au client.
 *
 * Idempotent : une pièce déjà appariée à un article n'en reçoit pas un second.
 * Rend le nombre d'articles créés.
 */
async function attachMountedParts(site, dea, { userId, note = 'Pièce reprise par l’import du parc' } = {}) {
  const Product = require('../models/Product')
  let created = 0
  const touched = new Set()

  const lines = [
    ...CONSUMABLE_LISTS.flatMap(kind => (dea[kind] || []).filter(l => l.product).map(line => ({ kind, line }))),
    ...(dea.armoire?.product ? [{ kind: ARMOIRE_CATEGORY, line: { product: dea.armoire.product } }] : []),
  ]
  if (!lines.length) return 0

  const attached = await ProductItem.find({
    dea: dea._id, category: { $in: [...CONSUMABLE_LISTS, ARMOIRE_CATEGORY] },
  })

  for (const kind of [...CONSUMABLE_LISTS, ARMOIRE_CATEGORY]) {
    const own = lines.filter(l => l.kind === kind).map(l => l.line)
    const { pairs } = pairPieces(own, attached.filter(i => i.category === kind))
    for (const line of own) {
      if (pairs.some(p => p.line === line)) continue
      const product = await Product.findById(line.product).select('category reference').lean()
      if (!product) continue
      await ProductItem.create({
        product:        line.product,
        category:       product.category || kind,
        reference:      product.reference || '',
        serialNumber:   line.serialNumber || undefined,
        lotNumber:      line.lotNumber || undefined,
        expirationDate: line.expiryDate || undefined,
        activationDate: line.activationDate || undefined,
        quantity:       1,
        status:         'installe',
        entryDate:      line.activationDate || dea.installationDate || new Date(),
        client:         site.client,
        site:           site._id,
        dea:            dea._id,
        notes:          note,
        history: [{ action: note, to: 'installe', note: site.name, user: userId, date: new Date() }],
        createdBy:      userId,
      })
      created++
      touched.add(String(line.product))
    }
  }
  for (const id of touched) await syncProductStock(id)
  return created
}

/**
 * Rattache l'armoire du DAE au produit du catalogue qui correspond à son
 * modèle (« AIVIA 100 » → « Armoire AIVIA 100 »). Sans modèle, plus de
 * produit. Un modèle que le catalogue ne connaît pas garde le produit
 * `fallback` (celui d'avant la modification) : une faute de frappe ne doit pas
 * faire disparaître l'armoire de la fiche produit. À appeler avant d'enregistrer.
 */
async function alignArmoireProduct(dea, fallback = null) {
  if (!dea.armoire) return
  const model = String(dea.armoire.model || '').trim()
  if (!model) { dea.armoire.product = undefined; return }
  const Product = require('../models/Product')
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = await Product.findOne({
    category: ARMOIRE_CATEGORY,
    name: { $in: [`Armoire ${model}`, model].map(n => new RegExp(`^${esc(n)}$`, 'i')) },
  }).select('_id').lean()
  dea.armoire.product = found?._id || dea.armoire.product || fallback || undefined
}

/**
 * Article de l'armoire d'un DAE, aligné sur ce que dit la fiche : créé s'il
 * manque, son modèle corrigé si l'armoire a changé de modèle, sorti du parc si
 * l'armoire a été retirée.
 */
async function syncDeaArmoire(site, dea, { userId } = {}) {
  const items = await ProductItem.find({ dea: dea._id, category: ARMOIRE_CATEGORY, status: 'installe' })
  const product = dea.armoire?.product
  if (!product) {
    for (const item of items) await unmountItem(item, { action: 'Armoire retirée du DAE', note: site.name })
    return
  }
  const [current, ...extra] = items
  for (const item of extra) await unmountItem(item, { action: 'Armoire en double sur le DAE', note: site.name })
  if (!current) {
    await attachMountedParts(site, dea, { userId, note: 'Armoire déclarée sur la fiche client' })
    return
  }
  if (String(current.product) !== String(product)) {
    const before = current.product
    current.product = product
    await logHistory(current, { action: 'Modèle d’armoire corrigé', from: 'installe', to: 'installe', note: site.name })
    await syncProductStock(before)
    await syncProductStock(product)
  }
}

module.exports = {
  modelViewSlugs, summarize,
  syncProductStock, logHistory, findItemForDea, syncDeaWithItem, syncDeaConsumables,
  detachItemFromParc, attachMountedParts, syncDeaArmoire, alignArmoireProduct, unmountItem,
  IN_STOCK_STATUSES,
}
