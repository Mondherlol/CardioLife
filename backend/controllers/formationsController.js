const path   = require('path')
const fs     = require('fs')
const fsp    = require('fs/promises')
const crypto = require('crypto')
const multer = require('multer')

const Formation = require('../models/Formation')

const UPLOAD_DIR = path.join(__dirname, '../uploads/formations')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
})
const uploadMultiple = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }).array('documents', 20)

const POPULATE_OPTS = [
  { path: 'createdBy',              select: 'fullName' },
  { path: 'attestationDeliveredBy', select: 'fullName' },
  { path: 'documents.uploadedBy',   select: 'fullName' },
  { path: 'history.by',             select: 'fullName' },
]

function pushHistory(formation, action, userId, details) {
  formation.history.push({ action, by: userId, at: new Date(), details })
}

async function getByClient(req, res) {
  try {
    const formations = await Formation.find({ client: req.params.clientId })
      .populate(POPULATE_OPTS)
      .sort({ date: -1 })
    res.json(formations)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function create(req, res) {
  uploadMultiple(req, res, async (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ message: 'Fichier trop volumineux (max 20 Mo).' })
    if (err) return res.status(400).json({ message: err.message || 'Erreur upload.' })

    try {
      const { client, clientName, title, date, description } = req.body
      if (!client || !title || !date)
        return res.status(422).json({ message: 'Client, titre et date requis.' })

      const docs = (req.files || []).map(f => ({
        path:         `formations/${f.filename}`,
        originalName: f.originalname,
        uploadedAt:   new Date(),
        uploadedBy:   req.user._id,
      }))

      const history = [{
        action:  'Formation créée',
        by:      req.user._id,
        at:      new Date(),
        details: title,
      }]
      docs.forEach(d => {
        history.push({ action: 'Document ajouté', by: req.user._id, at: new Date(), details: d.originalName })
      })

      const formation = await Formation.create({
        client, clientName, title, date, description,
        documents: docs,
        history,
        createdBy: req.user._id,
      })

      await formation.populate(POPULATE_OPTS)
      res.status(201).json(formation)
    } catch (e) {
      for (const f of req.files || []) await fsp.unlink(f.path).catch(() => {})
      res.status(500).json({ message: e.message })
    }
  })
}

async function update(req, res) {
  try {
    const { title, date, description } = req.body
    const formation = await Formation.findByIdAndUpdate(
      req.params.id,
      { title, date, description },
      { new: true, runValidators: true }
    ).populate(POPULATE_OPTS)
    if (!formation) return res.status(404).json({ message: 'Formation introuvable.' })
    res.json(formation)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function toggleAttestation(req, res) {
  try {
    const formation = await Formation.findById(req.params.id)
    if (!formation) return res.status(404).json({ message: 'Formation introuvable.' })

    formation.attestationDelivered = !formation.attestationDelivered
    if (formation.attestationDelivered) {
      formation.attestationDeliveredAt = new Date()
      formation.attestationDeliveredBy = req.user._id
      pushHistory(formation, 'Attestations marquées livrées', req.user._id)
    } else {
      formation.attestationDeliveredAt = undefined
      formation.attestationDeliveredBy = undefined
      pushHistory(formation, 'Attestations retirées', req.user._id)
    }

    await formation.save()
    await formation.populate(POPULATE_OPTS)
    res.json(formation)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function addDocuments(req, res) {
  uploadMultiple(req, res, async (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ message: 'Fichier trop volumineux (max 20 Mo).' })
    if (err) return res.status(400).json({ message: err.message || 'Erreur upload.' })

    try {
      const formation = await Formation.findById(req.params.id)
      if (!formation) return res.status(404).json({ message: 'Formation introuvable.' })
      if (!req.files?.length) return res.status(422).json({ message: 'Aucun fichier reçu.' })

      for (const f of req.files) {
        const doc = {
          path:         `formations/${f.filename}`,
          originalName: f.originalname,
          uploadedAt:   new Date(),
          uploadedBy:   req.user._id,
        }
        formation.documents.push(doc)
        pushHistory(formation, 'Document ajouté', req.user._id, f.originalname)
      }

      await formation.save()
      await formation.populate(POPULATE_OPTS)
      res.json(formation)
    } catch (e) {
      for (const f of req.files || []) await fsp.unlink(f.path).catch(() => {})
      res.status(500).json({ message: e.message })
    }
  })
}

async function removeDocument(req, res) {
  try {
    const formation = await Formation.findById(req.params.id)
    if (!formation) return res.status(404).json({ message: 'Formation introuvable.' })

    const doc = formation.documents.id(req.params.docId)
    if (!doc) return res.status(404).json({ message: 'Document introuvable.' })

    const originalName = doc.originalName
    await fsp.unlink(path.join(__dirname, '../uploads', doc.path)).catch(() => {})
    doc.deleteOne()
    pushHistory(formation, 'Document supprimé', req.user._id, originalName)

    await formation.save()
    await formation.populate(POPULATE_OPTS)
    res.json(formation)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function remove(req, res) {
  try {
    const formation = await Formation.findByIdAndDelete(req.params.id)
    if (!formation) return res.status(404).json({ message: 'Formation introuvable.' })
    for (const doc of formation.documents) {
      await fsp.unlink(path.join(__dirname, '../uploads', doc.path)).catch(() => {})
    }
    res.json({ message: 'Formation supprimée.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

module.exports = { getByClient, create, update, toggleAttestation, addDocuments, removeDocument, remove }
