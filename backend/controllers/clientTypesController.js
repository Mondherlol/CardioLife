const ClientType = require('../models/ClientType')

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

async function getAll(req, res) {
  const types = await ClientType.find().sort({ name: 1 })
  res.json(types)
}

async function create(req, res) {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ message: 'Nom du type requis.' })

  const slug = slugify(name)

  const exists = await ClientType.findOne({ slug })
  if (exists) return res.status(409).json({ message: 'Ce type existe déjà.' })

  const type = await ClientType.create({ name: name.trim(), slug })
  res.status(201).json(type)
}

async function remove(req, res) {
  const type = await ClientType.findByIdAndDelete(req.params.id)
  if (!type) return res.status(404).json({ message: 'Type introuvable.' })
  res.json({ message: 'Type supprimé.' })
}

module.exports = { getAll, create, remove }
