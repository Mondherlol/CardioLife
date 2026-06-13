const Intervention   = require('../models/Intervention')
const Installation   = require('../models/Installation')

const ADMIN_ROLES = ['superadmin', 'admin']

function isAdmin(user) {
  return ADMIN_ROLES.includes(user.role) || user.permissions?.canManageInterventions
}

/* ─── List ─────────────────────────────────────────────────── */
async function getAll(req, res) {
  try {
    const { status, technicien, client, search } = req.query
    const query = {}

    // Technicians only see their own interventions
    if (req.user.role === 'technicien') {
      query.technicien = req.user._id
    } else {
      if (technicien) query.technicien = technicien
      if (client)     query.client     = client
    }

    if (status) query.status = status

    if (search) {
      const re = { $regex: search, $options: 'i' }
      query.$or = [
        { clientName: re },
        { 'installationSnap.deviceType':   re },
        { 'installationSnap.serialNumber': re },
        { 'installationSnap.address':      re },
        { technicienName: re },
      ]
    }

    const interventions = await Intervention.find(query)
      .sort({ scheduledDate: -1 })
      .populate('technicien', 'fullName username')
      .populate('client', 'name')
      .lean()

    res.json(interventions)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Single ────────────────────────────────────────────────── */
async function getOne(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
      .populate('technicien', 'fullName username')
      .populate('client', 'name')
      .populate('installation', 'deviceType serialNumber address location')
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Technician can only view their own
    if (req.user.role === 'technicien' &&
        String(intervention.technicien?._id || intervention.technicien) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Create ────────────────────────────────────────────────── */
async function create(req, res) {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

    const {
      client, clientName,
      installation, installationSnap,
      technicien, technicienName,
      scheduledDate, notes,
    } = req.body

    const intervention = await Intervention.create({
      client, clientName,
      installation, installationSnap,
      technicien, technicienName,
      scheduledDate, notes,
      status: 'planifie',
      history: [{
        action:   'creation',
        user:     req.user._id,
        userName: req.user.fullName || req.user.username,
        details:  'Intervention créée',
      }],
      createdBy: req.user._id,
    })

    res.status(201).json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Update (admin) ────────────────────────────────────────── */
async function update(req, res) {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Accès refusé.' })

    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    const allowed = ['client','clientName','installation','installationSnap',
                     'technicien','technicienName','scheduledDate','notes','status']
    allowed.forEach(k => { if (req.body[k] !== undefined) intervention[k] = req.body[k] })

    intervention.history.push({
      action:   'modification',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  'Intervention modifiée par l\'admin',
    })

    await intervention.save()
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Submit rapport (technicien) ───────────────────────────── */
async function submitRapport(req, res) {
  try {
    const intervention = await Intervention.findById(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })

    // Technician can only fill their own
    if (req.user.role === 'technicien' &&
        String(intervention.technicien) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Accès refusé.' })
    }

    intervention.rapport = req.body.rapport || req.body
    intervention.status  = 'termine'
    intervention.completedDate = new Date()

    intervention.history.push({
      action:   'rapport_soumis',
      user:     req.user._id,
      userName: req.user.fullName || req.user.username,
      details:  'Fiche d\'intervention remplie et soumise',
    })

    await intervention.save()
    res.json(intervention)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Delete ────────────────────────────────────────────────── */
async function remove(req, res) {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Accès refusé.' })
    const intervention = await Intervention.findByIdAndDelete(req.params.id)
    if (!intervention) return res.status(404).json({ message: 'Intervention introuvable.' })
    res.json({ message: 'Supprimée.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── Search installations (no canManageDevices needed) ────── */
async function searchInstallations(req, res) {
  try {
    const { search = '', limit = 20 } = req.query
    const q = search.trim()
    const query = {}
    if (q) {
      const re = { $regex: q, $options: 'i' }
      query.$or = [
        { clientName:   re },
        { address:      re },
        { location:     re },
        { serialNumber: re },
        { deviceType:   re },
      ]
    }
    const data = await Installation.find(query)
      .sort(q ? { clientName: 1 } : { updatedAt: -1 })
      .limit(Number(limit))
      .populate('client', 'name')
      .lean()
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

module.exports = { getAll, getOne, create, update, submitRapport, remove, searchInstallations }
