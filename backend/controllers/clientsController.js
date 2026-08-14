const fs   = require('fs')
const path = require('path')
const { validationResult } = require('express-validator')
const Client   = require('../models/Client')
const Site     = require('../models/Site')
const Document = require('../models/Document')
const { getOrCreateClientFolder } = require('../utils/clientDocsFolder')

async function getAll(req, res) {
  const { governorate, search, q, page = 1, limit = 20, archived = 'false', sort = 'createdAt', dir = 'desc' } = req.query

  const filter = { isActive: archived === 'true' ? false : true }
  if (governorate) filter['address.governorate'] = governorate
  if (search)      filter.$text = { $search: search }
  if (q)           filter.name  = { $regex: q, $options: 'i' }

  const skip  = (Number(page) - 1) * Number(limit)
  const total = await Client.countDocuments(filter)
  // Les colonnes de la liste (sites, DEA, prochain contrôle) sont dérivées des
  // sites du client : on les calcule côté base pour rester triables et paginables.
  const sortFields = {
    name:        'name',
    sites:       'siteCount',
    deas:        'deaCount',
    nextControl: 'nextControlDate',
    contract:    'underContract',
    createdAt:   'createdAt',
  }
  const sortKey = sortFields[sort] || sortFields.createdAt
  const sortDir = dir === 'asc' ? 1 : -1

  const clients = await Client.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: 'sites',
        localField: '_id',
        foreignField: 'client',
        as: 'clientSites',
      },
    },
    {
      $addFields: {
        siteCount: { $size: '$clientSites' },
        deaCount: {
          $sum: {
            $map: {
              input: '$clientSites',
              as: 's',
              in: { $size: { $ifNull: ['$$s.deas', []] } },
            },
          },
        },
        // Prochain contrôle = la plus proche des échéances de tous les DEA du client.
        nextControlDate: {
          $min: {
            $reduce: {
              input: '$clientSites',
              initialValue: [],
              in: {
                $concatArrays: [
                  '$$value',
                  {
                    $map: {
                      input: { $ifNull: ['$$this.deas', []] },
                      as: 'd',
                      in: '$$d.nextControlDate',
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    { $project: { clientSites: 0 } },
    { $sort: { [sortKey]: sortDir, createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
  ]).collation({ locale: 'fr', strength: 1 })

  res.json({
    data: clients,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  })
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
