const { isAdmin } = require('./access')

/* Le rôle Administrateur vaut accès complet — c'est le contrat que tient
   déjà l'interface. Ces gardes n'exemptaient que le Super Admin : un admin
   sans cases cochées voyait le menu Clients puis se prenait un 403. */

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
    if (isAdmin(req.user)) return next()

    if (!req.user.permissions?.[permission]) {
      return res.status(403).json({
        message: `Permission manquante : ${permission}`,
      })
    }
    next()
  }
}

function requireAnyPermission(permissions) {
  return (req, res, next) => {
    if (isAdmin(req.user)) return next()

    if (!permissions.some(p => req.user.permissions?.[p])) {
      return res.status(403).json({
        message: `Permission manquante : ${permissions.join(' ou ')}`,
      })
    }
    next()
  }
}

/**
 * Ne protège que les écritures : les GET restent ouverts à tout utilisateur
 * authentifié.
 *
 * Le catalogue produits et le stock sont consultés bien au-delà du magasin —
 * poser un DEA suppose de lire les modèles et les numéros de série disponibles,
 * sans pour autant donner le droit de modifier le stock.
 */
function requirePermissionToWrite(permission) {
  const guard = requirePermission(permission)
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    return guard(req, res, next)
  }
}

module.exports = {
  requireSuperAdmin, requireAdminOrSuperAdmin,
  requirePermission, requireAnyPermission, requirePermissionToWrite,
}
