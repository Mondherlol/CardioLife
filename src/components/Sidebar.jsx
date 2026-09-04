import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Users, Package, FileText,
  Wrench, Calendar, File,
  Settings, UserCircle, Heart, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useSidebar } from '../context/SidebarContext'
import { useAuth }    from '../context/AuthContext'
import { canAccess } from '../lib/access'
import { get }        from '../api/http'

/* L'accès de chaque entrée est décidé par `src/lib/access.js`, miroir du
   middleware serveur. Filtrer ici sur le rôle seul laissait passer le Stock à
   des comptes dont la case « Gérer le stock » était décochée. */
const ALL_NAV = [
  { icon: LayoutDashboard, label: 'Tableau de bord', to: '/dashboard',   module: 'dashboard' },
  { icon: Users,           label: 'Clients',          to: '/clients',     module: 'clients' },
  { icon: Package,         label: 'Stock & Produits', to: '/stock',       module: 'stock' },
  { icon: FileText,        label: 'Contrats',         to: '/contrats',    module: 'contracts' },
  // Contrôles, installations, formations et remplacements : un seul suivi
  // terrain, une seule entrée de menu (onglets internes).
  { icon: Wrench,          label: 'Maintenance',      to: '/maintenance', module: 'maintenance' },
  { icon: Calendar,        label: 'Planning',         to: '/planning',    module: 'planning' },
  { icon: File,            label: 'Documents',        to: '/documents',   module: 'documents' },
]

const ALL_BOTTOM = [
  /* Suivi & To-do : masqué du menu le temps de la mise au point. La page reste
     accessible en tapant /dev — la route et ses droits sont inchangés.
     Pour la remontrer : décommenter la ligne ci-dessous et remettre `ListTodo`
     dans l'import de lucide-react en tête de fichier. */
  // { icon: ListTodo,   label: 'Suivi & To-do', to: '/dev',     module: 'dev' },
  { icon: Settings,   label: 'Paramètres', to: '/settings', module: 'settings' },
  { icon: UserCircle, label: 'Mon profil', to: '/profil',   module: 'profile' },
]

const ROLE_LABELS = {
  superadmin: 'Super Admin',
  admin:      'Administrateur',
  technicien: 'Technicien',
  commercial: 'Commercial',
  assistante: 'Assistante',
  readonly:   'Lecture seule',
}

function filterByAccess(items, user) {
  return items.filter(item => canAccess(user, item.module))
}

export default function Sidebar() {
  const { isCompact, toggleCompact, isMobileOpen, closeMobile } = useSidebar()
  const { user } = useAuth()
  const role     = user?.role || 'readonly'

  const [pendingCount, setPendingCount] = useState(0)

  // For technicians, fetch pending intervention count for the badge
  useEffect(() => {
    if (!user || role !== 'technicien') return
    get('/interventions?status=planifie')
      .then(data => setPendingCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {})
  }, [user, role])

  const navItems    = filterByAccess(ALL_NAV,    user)
  const bottomItems = filterByAccess(ALL_BOTTOM, user)

  const cls = [
    'sidebar',
    isCompact    ? 'sidebar--compact'     : '',
    isMobileOpen ? 'sidebar--mobile-open' : '',
  ].filter(Boolean).join(' ')

  return (
    <aside className={cls}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Heart size={18} strokeWidth={2.5} />
        </div>
        <span className="sidebar-logo-text">
          <span className="sidebar-brand">Cardio</span>
          <span className="sidebar-track">Track</span>
        </span>
      </div>

      {/* User identity chip (visible when expanded) */}
      {!isCompact && user && (
        <div className="sidebar-user-chip">
          <span className="sidebar-user-name">{user.fullName || user.username}</span>
          <span className="sidebar-user-role">{ROLE_LABELS[role] || role}</span>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {!isCompact && <p className="sidebar-section-label">Navigation</p>}
        {navItems.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-label={item.label}
              onClick={closeMobile}
              className={({ isActive }) =>
                `sidebar-item${isActive ? ' sidebar-item--active' : ''}`
              }
            >
              <span className="sidebar-item-icon">
                <Icon size={16} strokeWidth={1.8} />
              </span>
              <span className="sidebar-item-label">{item.label}</span>
              {item.to === '/maintenance' && pendingCount > 0 && !isCompact && (
                <span className="sidebar-badge">{pendingCount}</span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Bas : paramètres + toggle compact */}
      <div className="sidebar-bottom">
        {bottomItems.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-label={item.label}
              onClick={closeMobile}
              className={({ isActive }) =>
                `sidebar-item${isActive ? ' sidebar-item--active' : ''}`
              }
            >
              <span className="sidebar-item-icon">
                <Icon size={16} strokeWidth={1.8} />
              </span>
              <span className="sidebar-item-label">{item.label}</span>
            </NavLink>
          )
        })}

        {/* Bouton compact — desktop uniquement */}
        <button
          className="sidebar-toggle-btn"
          onClick={toggleCompact}
          title={isCompact ? 'Développer' : 'Réduire'}
        >
          {isCompact
            ? <ChevronRight size={15} strokeWidth={2} />
            : <ChevronLeft  size={15} strokeWidth={2} />
          }
          {!isCompact && <span className="sidebar-item-label">Réduire</span>}
        </button>
      </div>
    </aside>
  )
}
