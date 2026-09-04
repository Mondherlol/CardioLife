/**
 * Miroir serveur de `src/lib/access.js` — les deux tableaux doivent rester
 * alignés. Masquer une entrée de menu ne protège rien : l'URL de l'API reste
 * appelable à la main, c'est ici que l'accès se refuse pour de bon.
 */

const MODULES = {
  dashboard: {
    permissions: ['canViewReports', 'canManageClients', 'canManageStock', 'canManageContracts'],
  },
  clients:     { permissions: ['canManageClients'] },
  stock:       { permissions: ['canViewStock', 'canManageStock'] },
  contracts:   { permissions: ['canManageContracts'] },
  maintenance: {
    // Pas de rôle en dur : voir la note dans `src/lib/access.js`.
    permissions: ['canManageInterventions', 'canManageDevices', 'canManageFormations'],
  },
  planning:    { public: true },
  documents:   { permissions: ['canViewReports', 'canManageClients'] },
  dev:         { permissions: [] },
  settings:    { permissions: ['canManageUsers'] },
  profile:     { public: true },
}

/**
 * Préréglage appliqué quand on attribue un rôle. Ce sont des points de départ
 * raisonnables, pas un carcan : les cases restent modifiables ensuite, et c'est
 * bien la valeur enregistrée — pas le rôle — qui décide de l'accès.
 *
 * `superadmin` et `admin` reçoivent tout : leur rôle vaut déjà accès complet,
 * autant que la valeur enregistrée le reflète.
 */
const ROLE_PERMISSION_PRESETS = {
  admin:      'all',
  superadmin: 'all',
  technicien: ['canManageInterventions', 'canManageDevices', 'canViewStock'],
  commercial: ['canManageClients', 'canManageContracts', 'canViewReports', 'canViewStock'],
  assistante: ['canManageClients', 'canManageFormations', 'canViewReports', 'canViewStock'],
  readonly:   ['canViewReports'],
}

const PERMISSION_KEYS = [
  'canManageClients', 'canManageDevices', 'canManageContracts',
  'canViewStock', 'canManageStock',
  'canManageInterventions', 'canManageUsers', 'canViewReports', 'canManageFormations',
]

/** Objet complet (toutes les clés présentes) des droits par défaut d'un rôle. */
function defaultPermissionsForRole(role) {
  const granted = ROLE_PERMISSION_PRESETS[role] || []
  if (granted === 'all') return Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]))
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, granted.includes(k)]))
}

function isAdmin(user) {
  return user?.role === 'superadmin' || user?.role === 'admin'
}

function canAccess(user, moduleId) {
  if (!user) return false
  if (isAdmin(user)) return true

  const mod = MODULES[moduleId]
  if (!mod) return false
  if (mod.public) return true
  if (mod.roles?.includes(user.role)) return true

  return !!mod.permissions?.some(p => user.permissions?.[p])
}

/** Refuse l'accès au module pour toute méthode. */
function requireModule(moduleId) {
  return (req, res, next) => {
    if (canAccess(req.user, moduleId)) return next()
    res.status(403).json({ message: `Accès refusé au module « ${moduleId} ».` })
  }
}

/**
 * Ne protège que les écritures. Certaines lectures débordent leur module :
 * poser un DEA suppose de lire les modèles et numéros de série en stock sans
 * pour autant donner le droit d'y toucher.
 */
function requireModuleToWrite(moduleId) {
  const guard = requireModule(moduleId)
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    return guard(req, res, next)
  }
}

/**
 * Garde fine, sous le grain du module : les quatre volets de la Maintenance ne
 * s'ouvrent pas tous avec la même case. `roles` liste les métiers dont l'accès
 * est constitutif (un technicien fait des contrôles).
 */
function requireAny(permissions, roles = []) {
  return (req, res, next) => {
    if (isAdmin(req.user)) return next()
    if (roles.includes(req.user?.role)) return next()
    if (permissions.some(p => req.user?.permissions?.[p])) return next()
    res.status(403).json({
      message: `Permission manquante : ${permissions.join(' ou ')}`,
    })
  }
}

/**
 * Lecture et écriture n'ont pas le même prix. Le catalogue se consulte bien
 * au-delà du magasin — identifier la batterie montée sur un DAE pendant une
 * intervention suppose de lire le stock, sans donner le droit d'y toucher.
 */
function requireAnyToWrite(readPermissions, writePermissions) {
  const readGuard  = requireAny(readPermissions)
  const writeGuard = requireAny(writePermissions)
  return (req, res, next) => {
    const guard = (req.method === 'GET' || req.method === 'HEAD') ? readGuard : writeGuard
    return guard(req, res, next)
  }
}

/* Le stock : consultable avec l'un des deux droits, modifiable avec un seul. */
const stockGuard = () => requireAnyToWrite(['canViewStock', 'canManageStock'], ['canManageStock'])

module.exports = {
  requireAnyToWrite, stockGuard,
  MODULES, PERMISSION_KEYS, ROLE_PERMISSION_PRESETS, defaultPermissionsForRole,
  isAdmin, canAccess,
  requireModule, requireModuleToWrite, requireAny,
}
