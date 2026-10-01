const fs   = require('fs')
const path = require('path')
const { validationResult } = require('express-validator')
const Client   = require('../models/Client')
const Site     = require('../models/Site')
const Document = require('../models/Document')
const { getOrCreateClientFolder } = require('../utils/clientDocsFolder')
const { pageParams, pageResult, searchRegex } = require('../utils/paging')

/* Aplatit un tableau de tableaux (un par site, un par DEA…). */
const flatten = input => ({
  $reduce: { input, initialValue: [], in: { $concatArrays: ['$$value', { $ifNull: ['$$this', []] }] } },
})

/* Seuil sous lequel une batterie est dite faible — le même que l'analyse de l'import. */
const LOW_BATTERY = 25

/**
 * Colonnes de la liste dérivées des sites du client : nombre de sites et de
 * DEA, prochain contrôle, et l'état le plus préoccupant de ses consommables —
 * la batterie la plus faible, les DLC de batterie et d'électrodes les plus
 * proches, et combien de pièces sont déjà périmées ou faibles. Un client à
 * 29 sites se résume ainsi à ce qui décide d'un appel.
 *
 * Le lookup ne lit des sites que ce dont ces colonnes ont besoin.
 */
function derivedColumns(now = new Date()) {
  return [
    {
      $lookup: {
        from: 'sites',
        localField: '_id',
        foreignField: 'client',
        pipeline: [
          {
            $project: {
              deaCount: { $size: { $ifNull: ['$deas', []] } },
              next:     '$deas.nextControlDate',
              battExp:  flatten({ $ifNull: ['$deas.batteries.expiryDate', []] }),
              battLvl:  flatten({ $ifNull: ['$deas.batteries.level', []] }),
              elecExp:  flatten({ $ifNull: ['$deas.electrodes.expiryDate', []] }),
            },
          },
        ],
        as: 'clientSites',
      },
    },
    {
      $addFields: {
        siteCount: { $size: '$clientSites' },
        deaCount:  { $sum: '$clientSites.deaCount' },
        nextControlDate: { $min: flatten('$clientSites.next') },
        _battExp: flatten('$clientSites.battExp'),
        _battLvl: flatten('$clientSites.battLvl'),
        _elecExp: flatten('$clientSites.elecExp'),
      },
    },
    {
      $addFields: {
        battExpiry: { $min: '$_battExp' },
        battLevel:  { $min: '$_battLvl' },
        elecExpiry: { $min: '$_elecExp' },
        battExpiredCount: { $size: { $filter: { input: '$_battExp', cond: { $lt: ['$$this', now] } } } },
        battLowCount:     { $size: { $filter: { input: '$_battLvl', cond: { $lte: ['$$this', LOW_BATTERY] } } } },
        elecExpiredCount: { $size: { $filter: { input: '$_elecExp', cond: { $lt: ['$$this', now] } } } },
      },
    },
    { $project: { clientSites: 0, _battExp: 0, _battLvl: 0, _elecExp: 0 } },
  ]
}

const SORT_FIELDS = {
  name:        'name',
  sites:       'siteCount',
  deas:        'deaCount',
  nextControl: 'nextControlDate',
  contract:    'underContract',
  createdAt:   'createdAt',
  battLevel:   'battLevel',
  battExpiry:  'battExpiry',
  elecExpiry:  'elecExpiry',
}
/* Colonnes qui peuvent être vides (client sans DEA, sans batterie relevée…) :
   les clients sans valeur passent en fin de liste dans les deux sens de tri,
   sinon « les batteries les plus faibles » commenceraient par ceux qui n'en ont pas. */
const NULLABLE_SORTS = ['nextControlDate', 'battLevel', 'battExpiry', 'elecExpiry']
/* Champs portés par le client lui-même : triables avant le lookup. */
const STORED_SORTS = ['name', 'underContract', 'createdAt']

async function getAll(req, res) {
  const { governorate, search, q, archived = 'false', sort = 'createdAt', dir = 'desc' } = req.query
  const paging = pageParams(req.query)

  const filter = { isActive: archived === 'true' ? false : true }
  if (governorate) filter['address.governorate'] = governorate
  /* Recherche au fil de la frappe : « TELEP » doit trouver TELEPERFORMANCE,
     ce que l'index texte — qui ne connaît que des mots entiers — ne fait pas. */
  const re = searchRegex(search || q)
  if (re) filter.$or = [{ name: re }, { 'address.city': re }]

  const sortKey  = SORT_FIELDS[sort] || SORT_FIELDS.createdAt
  const nullable = NULLABLE_SORTS.includes(sortKey)
  // Départage stable : sans `_id`, deux clients de même valeur triée peuvent
  // changer de place d'un lot à l'autre — doublon ou client manquant au défilement.
  const sortStage = {
    $sort: {
      ...(nullable ? { _empty: 1 } : {}),
      [sortKey]: dir === 'asc' ? 1 : -1, createdAt: -1, _id: 1,
    },
  }
  const slice   = [{ $skip: paging.skip }, { $limit: paging.limit }]
  const derived = derivedColumns()
  const empties = nullable
    ? [{ $addFields: { _empty: { $cond: [{ $eq: [{ $ifNull: [`$${sortKey}`, null] }, null] }, 1, 0] } } }]
    : []

  /* Tri sur un champ du client : on découpe d'abord, seul le lot est enrichi.
     Tri sur une colonne dérivée : elle doit être calculée pour tous avant. */
  const pipeline = STORED_SORTS.includes(sortKey)
    ? [{ $match: filter }, sortStage, ...slice, ...derived]
    : [{ $match: filter }, ...derived, ...empties, sortStage, ...slice, { $project: { _empty: 0 } }]

  const [total, clients] = await Promise.all([
    Client.countDocuments(filter),
    Client.aggregate(pipeline).collation({ locale: 'fr', strength: 1 }),
  ])

  res.json(pageResult(clients, total, paging))
}

async function lookup(req, res) {
  const { q, limit = 20 } = req.query
  const filter = { isActive: true }
  if (q) filter.name = { $regex: q, $options: 'i' }
  const clients = await Client.find(filter)
    .select('name address.city')
    .limit(Number(limit))
    .sort({ name: 1 })
  res.json(clients)
}

async function getById(req, res) {
  const client = await Client.findById(req.params.id)
    .populate('createdBy', 'username fullName')
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  res.json(client)
}

async function getDocumentsFolder(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  const folder = await getOrCreateClientFolder(client, req.user._id)
  res.json({ folderId: folder._id })
}

async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const client = await Client.create({ ...req.body, createdBy: req.user._id })
  res.status(201).json(client)
}

async function update(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const before = await Client.findById(req.params.id).select('name documentsFolder')
  if (!before) return res.status(404).json({ message: 'Client introuvable.' })

  const client = await Client.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  )

  if (client.documentsFolder && req.body.name && req.body.name !== before.name) {
    await Document.findByIdAndUpdate(client.documentsFolder, { name: client.name })
  }

  res.json(client)
}

/* ── Logo du client ────────────────────────────────── */

const LOGO_DIR = path.join(__dirname, '..', 'uploads', 'clients')

function removeLogoFile(filename) {
  if (filename) fs.unlink(path.join(LOGO_DIR, filename), () => {})
}

/* POST /api/clients/:id/logo */
async function uploadLogo(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' })

  const client = await Client.findById(req.params.id)
  if (!client) {
    removeLogoFile(req.file.filename)
    return res.status(404).json({ message: 'Client introuvable.' })
  }

  removeLogoFile(client.logo)
  client.logo = req.file.filename
  await client.save()
  res.json(client)
}

/* DELETE /api/clients/:id/logo */
async function deleteLogo(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })

  if (client.logo) {
    removeLogoFile(client.logo)
    client.logo = null
    await client.save()
  }
  res.json(client)
}

async function archive(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  client.isActive = false
  await client.save()
  res.json({ message: 'Client archivé.' })
}

async function restore(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  client.isActive = true
  await client.save()
  res.json({ message: 'Client restauré.' })
}

async function permanentDelete(req, res) {
  const client = await Client.findById(req.params.id)
  if (!client) return res.status(404).json({ message: 'Client introuvable.' })
  if (client.isActive) {
    return res.status(400).json({ message: 'Archivez d\'abord le client avant de le supprimer définitivement.' })
  }
  removeLogoFile(client.logo)
  await Site.deleteMany({ client: client._id })
  await client.deleteOne()
  res.json({ message: 'Client supprimé définitivement.' })
}

module.exports = {
  getAll, getById, create, update, archive, restore, permanentDelete,
  getDocumentsFolder, lookup, uploadLogo, deleteLogo,
}
