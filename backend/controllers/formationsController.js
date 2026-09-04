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
  // `contacts` : le responsable du site est le destinataire naturel des
  // attestations — la fiche formation l'affiche sans requête supplémentaire.
  // `deas.deviceType` alimente la colonne DEA du tableau : on forme les agents
  // sur le modèle posé chez eux.
  { path: 'site',                   select: 'name address contacts deas.deviceType' },
  { path: 'createdBy',              select: 'fullName' },
  { path: 'attestationDeliveredBy', select: 'fullName' },
  { path: 'documents.uploadedBy',   select: 'fullName' },
  { path: 'history.by',             select: 'fullName' },
  { path: 'assignedTo',             select: 'fullName username' },
]

function pushHistory(formation, action, userId, details) {
  formation.history.push({ action, by: userId, at: new Date(), details })
}

// Normalise le champ assignedTo reçu (FormData répété → tableau, unique → string).
function parseAssignedTo(value) {
  if (value == null) return undefined
  const arr = Array.isArray(value) ? value : [value]
  return arr.filter(Boolean)
}

/* Les objets riches (participants, contact) transitent en JSON : le formulaire
   de création passe par FormData, l'édition par du JSON classique. */
function parseJsonField(value) {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}

const PARTICIPANT_STATUSES = ['a_former', 'forme', 'absent']

function cleanParticipants(value) {
  const arr = parseJsonField(value)
  if (!Array.isArray(arr)) return undefined
  return arr
    .filter(p => p && String(p.name || '').trim())
    .map(p => ({
      name:   String(p.name).trim(),
      role:   p.role  ? String(p.role).trim()  : undefined,
      email:  p.email ? String(p.email).trim() : undefined,
      phone:  p.phone ? String(p.phone).trim() : undefined,
      status: PARTICIPANT_STATUSES.includes(p.status) ? p.status : 'a_former',
      notes:  p.notes ? String(p.notes).trim() : undefined,
    }))
}

function cleanContact(value) {
  const c = parseJsonField(value)
  if (!c || typeof c !== 'object') return undefined
  return {
    name:  c.name  ? String(c.name).trim()  : undefined,
    role:  c.role  ? String(c.role).trim()  : undefined,
    email: c.email ? String(c.email).trim() : undefined,
    phone: c.phone ? String(c.phone).trim() : undefined,
  }
}

/* Résumé lisible d'une liste nominative, pour l'historique. */
function participantsSummary(list) {
  const formed = list.filter(p => p.status === 'forme').length
  const todo   = list.filter(p => p.status === 'a_former').length
  return `${list.length} inscrit${list.length > 1 ? 's' : ''} · ${formed} formé${formed > 1 ? 's' : ''} · ${todo} à former`
}

async function getAll(req, res) {
  try {
    const { from, to, client, site, status } = req.query
    const filter = {}
    // Plage de dates (utilisée par le planning pour ne charger que la fenêtre visible)
    if (from || to) {
      filter.date = {}
      if (from) filter.date.$gte = new Date(from)
      if (to)   filter.date.$lte = new Date(to)
    }
    if (client) filter.client = client
    if (site)   filter.site   = site
    if (status) filter.status = status

    const formations = await Formation.find(filter)
      .populate(POPULATE_OPTS)
      .sort({ date: -1 })
    res.json(formations)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function getByClient(req, res) {
  try {
    const formations = await Formation.find({ client: req.params.clientId })
      .populate(POPULATE_OPTS)
      .sort({ date: -1 })
    res.json(formations)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function getBySite(req, res) {
  try {
    const formations = await Formation.find({ site: req.params.siteId })
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
      const {
        client, clientName, site, siteName, participantsCount,
        title, date, end, status, description,
      } = req.body
      if (!client || !title || !date)
        return res.status(422).json({ message: 'Client, titre et date requis.' })

      const assignedTo   = parseAssignedTo(req.body.assignedTo)
      const participants = cleanParticipants(req.body.participants) || []
      const contact      = cleanContact(req.body.attestationContact)
      const delivered    = req.body.attestationDelivered === true
        || req.body.attestationDelivered === 'true'

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
      if (participants.length) {
        history.push({
          action: 'Participants inscrits', by: req.user._id, at: new Date(),
          details: participantsSummary(participants),
        })
      }

      const formation = await Formation.create({
        client, clientName, title, date, description,
        site:     site || undefined,
        siteName: siteName || undefined,
        // La liste nominative prime : le hook du modèle recalcule le compte.
        participantsCount: Number(participantsCount) || 0,
        participants,
        attestationContact: contact,
        end:    end || undefined,
        status: status || 'planifie',
        // Une formation saisie après coup peut naître déjà livrée.
        ...(delivered ? {
          attestationDelivered:   true,
          attestationDeliveredAt: new Date(),
          attestationDeliveredBy: req.user._id,
        } : {}),
        assignedTo,
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
    const formation = await Formation.findById(req.params.id)
    if (!formation) return res.status(404).json({ message: 'Formation introuvable.' })

    const { title, date, end, status, description, client, clientName } = req.body

    const prevStatus = formation.status

    if (title       !== undefined) formation.title       = title
    if (date        !== undefined) formation.date        = date
    if (end         !== undefined) formation.end         = end || undefined
    if (status      !== undefined) formation.status      = status
    if (description !== undefined) formation.description  = description
    if (client      !== undefined) formation.client      = client
    if (clientName  !== undefined) formation.clientName  = clientName
    if (req.body.site     !== undefined) formation.site     = req.body.site || undefined
    if (req.body.siteName !== undefined) formation.siteName = req.body.siteName || undefined
    if (req.body.participantsCount !== undefined) {
      formation.participantsCount = Number(req.body.participantsCount) || 0
    }
    if (req.body.assignedTo !== undefined) {
      formation.assignedTo = parseAssignedTo(req.body.assignedTo) || []
    }
    if (req.body.attestationContact !== undefined) {
      formation.attestationContact = cleanContact(req.body.attestationContact) || {}
    }

    if (req.body.participants !== undefined) {
      const list = cleanParticipants(req.body.participants) || []
      // Le passage d'un agent de « à former » à « formé » est le fait marquant
      // de la séance : il mérite sa ligne d'historique.
      const before = formation.participants.filter(p => p.status === 'forme').length
      formation.participants = list
      const after = list.filter(p => p.status === 'forme').length
      pushHistory(formation, before === after ? 'Participants mis à jour' : 'Participants formés',
        req.user._id, participantsSummary(list))
    }

    /* Livraison des attestations : dernière étape du cycle, pilotée depuis la
       fiche comme un statut à part entière. */
    if (req.body.attestationDelivered !== undefined) {
      const wanted = req.body.attestationDelivered === true || req.body.attestationDelivered === 'true'
      if (wanted !== formation.attestationDelivered) {
        formation.attestationDelivered = wanted
        if (wanted) {
          formation.attestationDeliveredAt = new Date()
          formation.attestationDeliveredBy = req.user._id
          const to = formation.attestationContact?.email || formation.attestationContact?.name
          pushHistory(formation, 'Attestations livrées', req.user._id, to ? `à ${to}` : undefined)
        } else {
          formation.attestationDeliveredAt = undefined
          formation.attestationDeliveredBy = undefined
          pushHistory(formation, 'Attestations retirées', req.user._id)
        }
      }
    }

    if (status !== undefined && status !== prevStatus) {
      pushHistory(formation, 'Statut modifié', req.user._id, `${prevStatus} → ${status}`)
    } else {
      pushHistory(formation, 'Formation modifiée', req.user._id)
    }

    await formation.save()
    await formation.populate(POPULATE_OPTS)
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

module.exports = {
  getAll, getByClient, getBySite, create, update, toggleAttestation,
  addDocuments, removeDocument, remove,
}
