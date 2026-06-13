const Control = require('../models/Control')

function dateRange() {
  const from = new Date(); from.setFullYear(from.getFullYear() - 1)
  const to   = new Date(); to.setFullYear(to.getFullYear() + 1)
  return { $gte: from, $lte: to }
}

async function getByInstallation(req, res) {
  try {
    const controls = await Control.find({
      installation:  req.params.installId,
      scheduledDate: dateRange(),
    })
      .populate('technicien', 'fullName')
      .sort({ scheduledDate: 1 })
    res.json(controls)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function getByClient(req, res) {
  try {
    const controls = await Control.find({
      client:        req.params.clientId,
      scheduledDate: dateRange(),
    })
      .populate('technicien', 'fullName')
      .populate('installation', 'address location deviceType serialNumber')
      .sort({ scheduledDate: 1 })
    res.json(controls)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function create(req, res) {
  try {
    const { installation, client, clientName, type, scheduledDate } = req.body
    if (!installation || !type || !scheduledDate)
      return res.status(422).json({ message: 'Installation, type et date requis.' })
    const control = await Control.create({
      installation, client: client || undefined, clientName: clientName || undefined,
      type, scheduledDate,
      createdBy: req.user._id,
    })
    res.status(201).json(control)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function update(req, res) {
  try {
    const control = await Control.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('technicien', 'fullName')
    if (!control) return res.status(404).json({ message: 'Contrôle introuvable.' })
    res.json(control)
  } catch (err) { res.status(500).json({ message: err.message }) }
}

async function remove(req, res) {
  try {
    const c = await Control.findByIdAndDelete(req.params.id)
    if (!c) return res.status(404).json({ message: 'Contrôle introuvable.' })
    res.json({ message: 'Supprimé.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

module.exports = { getByInstallation, getByClient, create, update, remove }
