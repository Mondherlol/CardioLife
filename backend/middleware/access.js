/**
 * Miroir serveur de `src/lib/access.js` — les deux tableaux doivent rester
 * alignés. Masquer une entrée de menu ne protège rien : l'URL de l'API reste
 * appelable à la main, c'est ici que l'accès se refuse pour de bon.
 */

const MODULES = {
  dashboard:   { permissions: ['canAccessDashboard'] },
  clients:     { permissions: ['canManageClients'] },
  stock:       { permissions: ['canViewStock', 'canManageStock'] },
  contracts:   { permissions: ['canManageContracts'] },
  maintenance: {
    // Pas de rôle en dur : voir la note dans `src/lib/access.js`.
    permissions: ['canManageInterventions', 'canManageDevices', 'canManageFormations'],
  },
  planning:    { permissions: ['canAccessPlanning'] },
  documents:   { permissions: ['canAccessDocuments'] },
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
  technicien: ['canManageInterventions', 'canManageDevices', 'canViewStock', 'canAccessPlanning'],
  commercial: ['canAccessDashboard', 'canManageClients', 'canManageContracts', 'canViewStock',
               'canAccessPlanning', 'canAccessDocuments'],
  assistante: ['canAccessDashboard', 'canManageClients', 'canManageFormations', 'canViewStock',
               'canAccessPlanning', 'canAccessDocuments'],
  readonly:   ['canAccessDashboard', 'canAccessPlanning', 'canAccessDocuments'],
}

const PERMISSION_KEYS = [
  'canManageClients', 'canManageDevices', 'canManageContracts',
  'canViewStock', 'canManageStock',
  'canManageInterventions', 'canManageUsers', 'canViewReports', 'canManageFormations',
  'canAccessDashboard', 'canAccessPlanning', 'canAccessDocuments',
]

/**
 * `canAccessDashboard`, `canAccessPlanning` et `canAccessDocuments` sont venus
 * après coup, pour qu'un onglet du menu = une case. Les comptes enregistrés
 * avant n'ont pas la clé : on reprend alors l'ancienne règle, pour que rien ne
 * change tant qu'un admin n'a pas réenregistré le compte.
 */
function resolvePermissions(perms = {}) {
  const p = { ...(perms?.toObject ? perms.toObject() : perms) }
  if (p.canAccessDashboard === undefined) {
    p.canAccessDashboard = !!(p.canViewReports || p.canManageClients || p.canManageStock || p.canManageContracts)
  }
  if (p.canAccessPlanning === undefined) p.canAccessPlanning = true
  if (p.canAccessDocuments === undefined) {
    p.canAccessDocuments = !!(p.canViewReports || p.canManageClients)
  }
  return p
}

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

  const perms = resolvePermissions(user.permissions)
  return !!mod.permissions?.some(p => perms[p])
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
  MODULES, PERMISSION_KEYS, resolvePermissions, ROLE_PERMISSION_PRESETS, defaultPermissionsForRole,
  isAdmin, canAccess,
  requireModule, requireModuleToWrite, requireAny,
}
