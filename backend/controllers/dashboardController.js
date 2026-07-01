const Installation  = require('../models/Installation')
const Client        = require('../models/Client')
const Intervention  = require('../models/Intervention')
const Product       = require('../models/Product')
const StockMovement = require('../models/StockMovement')
const Appointment   = require('../models/Appointment')

const APPOINTMENT_TYPE_LABELS = {
  controle:     'Contrôle',
  intervention: 'Intervention',
  installation: 'Installation',
  formation:    'Formation',
  reunion:      'Réunion',
  autre:        'Autre',
}

async function getDashboard(req, res) {
  const now           = new Date()
  const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1)

  const [
    installationsTotal,
    clientsTotal,
    interventionsThisMonth,
    interventionsPending,
    productStats,
    recentMovements,
    recentInterventions,
    recentAppointments,
  ] = await Promise.all([
    Installation.countDocuments(),
    Client.countDocuments({ isActive: true }),
    Intervention.countDocuments({ createdAt: { $gte: startOfMonth } }),
    Intervention.countDocuments({ status: { $in: ['planifie', 'en_cours'] } }),
    Product.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total:    { $sum: 1 },
          lowStock: { $sum: { $cond: [{ $and: [{ $gt: ['$alertThreshold', 0] }, { $lte: ['$stock', '$alertThreshold'] }] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
        },
      },
    ]),
    StockMovement.find()
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('product',   'name')
      .populate('createdBy', 'fullName username'),
    Intervention.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('clientName technicienName status scheduledDate createdAt createdBy')
      .populate('createdBy', 'fullName username'),
    Appointment.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title type clientName createdAt createdBy')
      .populate('createdBy', 'fullName username'),
  ])

  /* ── Build activity feed ── */
  const activities = []

  recentMovements.forEach(mv => {
    const typeLabel = mv.type === 'entree' ? 'Entrée stock' : mv.type === 'sortie' ? 'Sortie stock' : 'Correction stock'
    activities.push({
      type:   'stock',
      action: typeLabel,
      detail: `${mv.quantity} × ${mv.product?.name || 'Produit supprimé'}`,
      user:   mv.createdBy?.fullName || mv.createdBy?.username || null,
      date:   mv.createdAt,
    })
  })

  recentInterventions.forEach(iv => {
    activities.push({
      type:   'intervention',
      action: 'Intervention créée',
      detail: iv.clientName || '—',
      user:   iv.createdBy?.fullName || iv.createdBy?.username || iv.technicienName || null,
      date:   iv.createdAt,
    })
  })

  recentAppointments.forEach(ap => {
    activities.push({
      type:   'appointment',
      action: `RDV — ${APPOINTMENT_TYPE_LABELS[ap.type] || ap.type}`,
      detail: ap.title || ap.clientName || '—',
      user:   ap.createdBy?.fullName || ap.createdBy?.username || null,
      date:   ap.createdAt,
    })
  })

  activities.sort((a, b) => new Date(b.date) - new Date(a.date))

  const stats = productStats[0] || { total: 0, lowStock: 0, outOfStock: 0 }

  res.json({
    stats: {
      installations:         installationsTotal,
      clients:               clientsTotal,
      interventionsThisMonth,
      interventionsPending,
      lowStock:              stats.lowStock,
      outOfStock:            stats.outOfStock,
      totalProducts:         stats.total,
    },
    activities: activities.slice(0, 10),
  })
}

module.exports = { getDashboard }
