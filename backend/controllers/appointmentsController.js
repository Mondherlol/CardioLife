const Appointment = require('../models/Appointment')

async function getAll(req, res) {
  try {
    const { start, end, type, status } = req.query
    const filter = {}
    if (start || end) {
      filter.start = {}
      if (start) filter.start.$gte = new Date(start)
      if (end)   filter.start.$lte = new Date(end)
    }
    if (type)   filter.type   = type
    if (status) filter.status = status

    const appointments = await Appointment.find(filter)
      .populate('client', 'name')
      .populate('assignedTo', 'fullName username')
      .sort({ start: 1 })

    res.json(appointments)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function create(req, res) {
  try {
    const { title, start, end, allDay, type, status, description, client, clientName, installation, assignedTo } = req.body
    if (!title || !start) return res.status(422).json({ message: 'Titre et date de début requis.' })

    const appt = await Appointment.create({
      title, start, end, allDay, type, status, description,
      client:       client       || undefined,
      clientName:   clientName   || undefined,
      installation: installation || undefined,
      assignedTo:   Array.isArray(assignedTo) ? assignedTo : undefined,
      createdBy:    req.user._id,
    })
    res.status(201).json(appt)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function update(req, res) {
  try {
    const appt = await Appointment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
    if (!appt) return res.status(404).json({ message: 'Rendez-vous introuvable.' })
    res.json(appt)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function remove(req, res) {
  try {
    const appt = await Appointment.findByIdAndDelete(req.params.id)
    if (!appt) return res.status(404).json({ message: 'Rendez-vous introuvable.' })
    res.json({ message: 'Supprimé.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

module.exports = { getAll, create, update, remove }
