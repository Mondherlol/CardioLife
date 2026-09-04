/**
 * Source de vérité unique des droits d'accès aux modules.
 *
 * Deux mécanismes coexistaient jusqu'ici — le `role` et les `permissions` —
 * sans jamais se parler : le menu filtrait par rôle, les écrans par permission.
 * Un utilisateur « Maintenance + Planning » voyait donc le Stock, parce que son
 * rôle (commercial, assistante, readonly) l'y autorisait malgré ses cases
 * décochées.
 *
 * Désormais un seul tableau décide, ici et dans `backend/middleware/access.js`
 * qui en est le miroir. Les deux fichiers doivent rester alignés.
 *
 * Règle de lecture d'un module :
 *   1. superadmin et admin passent toujours ;
 *   2. sinon un `role` listé dans `roles` suffit (métiers dont l'accès est
 *      constitutif — un technicien a besoin de la Maintenance) ;
 *   3. sinon il faut au moins une des `permissions`.
 *   4. `public: true` ouvre le module à tout utilisateur authentifié.
 */

export const MODULES = {
  dashboard: {
    label: 'Tableau de bord',
    // Le tableau de bord agrège clients, stock et contrats : le voir suppose
    // d'avoir le droit d'en voir au moins une part.
    permissions: ['canViewReports', 'canManageClients', 'canManageStock', 'canManageContracts'],
  },
  clients: {
    label: 'Clients',
    permissions: ['canManageClients'],
  },
  stock: {
    label: 'Stock & Produits',
    // La consultation suffit à ouvrir le menu ; les écritures restent derrière
    // `canManageStock`, contrôlées route par route.
    permissions: ['canViewStock', 'canManageStock'],
  },
  contracts: {
    label: 'Contrats',
    permissions: ['canManageContracts'],
  },
  maintenance: {
    label: 'Maintenance',
    /* Aucun rôle en dur ici. Un technicien accédait à la Maintenance quoi qu'on
       coche : ses permissions ne servaient à rien, ce qui donnait l'impression
       que les droits n'étaient pas respectés. Le préréglage du rôle coche les
       bonnes cases à la création — ensuite, ce sont elles qui décident. */
    permissions: ['canManageInterventions', 'canManageDevices', 'canManageFormations'],
  },
  planning: {
    label: 'Planning',
    // Chacun consulte son propre agenda : le filtrage se fait sur les données,
    // pas sur l'accès à la page.
    public: true,
  },
  documents: {
    label: 'Documents',
    permissions: ['canViewReports', 'canManageClients'],
  },
  dev: {
    label: 'Suivi & To-do',
    /* Volontairement sans permission : `canAccess` laisse passer les Admins et
       Super Admins avant d'examiner cette liste, et personne d'autre. Le suivi
       du chantier logiciel n'est pas un module métier à déléguer. */
    permissions: [],
  },
  settings: {
    label: 'Paramètres',
    permissions: ['canManageUsers'],
  },
  profile: {
    label: 'Mon profil',
    public: true,
  },
}

/** Ordre de repli quand la page demandée est interdite. */
export const MODULE_FALLBACK_ORDER = [
  'dashboard', 'maintenance', 'planning', 'clients',
  'stock', 'contracts', 'documents', 'profile',
]

/**
 * Préréglage appliqué quand on attribue un rôle. Ce sont des points de départ
 * raisonnables, pas un carcan : les cases restent modifiables ensuite, et c'est
 * bien la valeur enregistrée — pas le rôle — qui décide de l'accès.
 *
 * `superadmin` et `admin` reçoivent tout : leur rôle vaut déjà accès complet,
 * autant que la valeur enregistrée le reflète.
 */
export const ROLE_PERMISSION_PRESETS = {
  admin:      'all',
  superadmin: 'all',
  technicien: ['canManageInterventions', 'canManageDevices', 'canViewStock'],
  commercial: ['canManageClients', 'canManageContracts', 'canViewReports', 'canViewStock'],
  assistante: ['canManageClients', 'canManageFormations', 'canViewReports', 'canViewStock'],
  readonly:   ['canViewReports'],
}

export const PERMISSION_KEYS = [
  'canManageClients', 'canManageDevices', 'canManageContracts',
  'canViewStock', 'canManageStock',
  'canManageInterventions', 'canManageUsers', 'canViewReports', 'canManageFormations',
]

/** Objet complet (toutes les clés présentes) des droits par défaut d'un rôle. */
export function defaultPermissionsForRole(role) {
  const granted = ROLE_PERMISSION_PRESETS[role] || []
  if (granted === 'all') return Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]))
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, granted.includes(k)]))
}

export function isAdmin(user) {
  return user?.role === 'superadmin' || user?.role === 'admin'
}

export function canAccess(user, moduleId) {
  if (!user) return false
  if (isAdmin(user)) return true

  const mod = MODULES[moduleId]
  if (!mod) return false
  if (mod.public) return true

  if (mod.roles?.includes(user.role)) return true

  return !!mod.permissions?.some(p => user.permissions?.[p])
}

/** Premier module accessible — cible de redirection après connexion. */
export function firstAccessibleModule(user) {
  return MODULE_FALLBACK_ORDER.find(id => canAccess(user, id)) || 'profile'
}

export const MODULE_PATHS = {
  dashboard:   '/dashboard',
  dev:         '/dev',
  clients:     '/clients',
  stock:       '/stock',
  contracts:   '/contrats',
  maintenance: '/maintenance',
  planning:    '/planning',
  documents:   '/documents',
  settings:    '/settings',
  profile:     '/profil',
}

export function firstAccessiblePath(user) {
  return MODULE_PATHS[firstAccessibleModule(user)]
}

/**
 * Droits sur le stock, distingués parce qu'ils ne se valent pas : consulter le
 * catalogue est courant — identifier la batterie montée sur un DAE pendant une
 * intervention l'exige — modifier les quantités l'est beaucoup moins.
 */
export function stockRights(user) {
  const admin = isAdmin(user)
  return {
    canView: admin || !!user?.permissions?.canViewStock || !!user?.permissions?.canManageStock,
    canEdit: admin || !!user?.permissions?.canManageStock,
  }
}
