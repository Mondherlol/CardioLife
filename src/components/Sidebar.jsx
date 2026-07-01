import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Users, Zap, Package, Boxes, FileText,
  Wrench, Calendar, File, Map, Mail,
  Settings, UserCircle, Heart, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useSidebar } from '../context/SidebarContext'
import { useAuth }    from '../context/AuthContext'
import { get }        from '../api/http'

const ALL_NAV = [
  { icon: LayoutDashboard, label: 'Tableau de bord',  to: '/dashboard',      roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: Users,           label: 'Clients',           to: '/clients',        roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: Zap,             label: 'DAE installés',     to: '/devices',        roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: Package,         label: 'Stock & Produits',  to: '/stock',          roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: Boxes,           label: 'Packs',             to: '/packs',          roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: FileText,        label: 'Contrats',          to: '/contrats',       roles: ['superadmin','admin','commercial','assistante'] },
  { icon: Wrench,          label: 'Contrôles',         to: '/interventions',  roles: null }, // all roles
  { icon: Calendar,        label: 'Planning',          to: '/planning',       roles: null }, // all roles
  { icon: File,            label: 'Documents',         to: '/documents',      roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: Map,             label: 'Carte Tunisie',     to: '/carte',          roles: ['superadmin','admin','commercial','assistante','readonly'] },
  { icon: Mail,            label: 'Emails & Relances', to: '/emails',         roles: ['superadmin','admin','commercial','assistante'] },
]

const ALL_BOTTOM = [
  { icon: Settings,   label: 'Paramètres', to: '/settings', roles: ['superadmin','admin'] },
  { icon: UserCircle, label: 'Mon profil', to: '/profil',   roles: null },
]

const ROLE_LABELS = {
  superadmin: 'Super Admin',
  admin:      'Administrateur',
  technicien: 'Technicien',
  commercial: 'Commercial',
  assistante: 'Assistante',
  readonly:   'Lecture seule',
}

function filterByRole(items, role) {
  return items.filter(item => !item.roles || item.roles.includes(role))
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

  const navItems    = filterByRole(ALL_NAV,    role)
  const bottomItems = filterByRole(ALL_BOTTOM, role)

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
              {item.to === '/interventions' && pendingCount > 0 && !isCompact && (
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
