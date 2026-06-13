function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Réservé au Super Admin.' })
  }
  next()
}

function requireAdminOrSuperAdmin(req, res, next) {
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Réservé aux Admins.' })
  }
  next()
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user.role === 'superadmin') return next()

    if (!req.user.permissions?.[permission]) {
      return res.status(403).json({
        message: `Permission manquante : ${permission}`,
      })
    }
    next()
  }
}

module.exports = { requireSuperAdmin, requireAdminOrSuperAdmin, requirePermission }
