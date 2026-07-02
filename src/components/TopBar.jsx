import { useLocation } from 'react-router-dom'
import { Bell, LogOut, ChevronRight, Menu } from 'lucide-react'
import { useSidebar } from '../context/SidebarContext'

const pageTitles = {
  '/dashboard':    'Tableau de bord',
  '/clients':      'Clients',
  '/devices':      'DAE installés',
  '/stock':        'Stock & Produits',
  '/contrats':     'Contrats',
  '/interventions':'Interventions',
  '/calendrier':   'Calendrier',
  '/documents':    'Documents',
  '/carte':        'Carte Tunisie',
  '/emails':       'Emails & Relances',
  '/parametres':   'Paramètres',
  '/profil':       'Mon profil',
}

export default function TopBar({ onLogout, user }) {
  const location   = useLocation()
  const { openMobile } = useSidebar()
  const title      = pageTitles[location.pathname] || 'CardioTrack'
  const initials   = user?.fullName
    ? user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'A'

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* Hamburger — mobile uniquement */}
        <button className="topbar-hamburger" onClick={openMobile} title="Menu">
          <Menu size={20} strokeWidth={1.8} />
        </button>

        <div className="topbar-breadcrumb">
          <span className="topbar-breadcrumb-home">Accueil</span>
          <ChevronRight size={13} color="var(--gray-300)" />
          <span className="topbar-breadcrumb-current">{title}</span>
        </div>
      </div>

      <div className="topbar-right">
        <button className="topbar-icon-btn" title="Notifications" style={{ display: 'none' }}>
          <Bell size={17} strokeWidth={1.8} />
          <span className="topbar-notif-badge">9</span>
        </button>
        <div className="topbar-divider" />
        <div className="topbar-user">
          <div className="topbar-avatar">{initials}</div>
          <div className="topbar-user-info">
            <span className="topbar-user-name">{user?.fullName || 'Admin'}</span>
            <span className="topbar-user-role">{user?.role || '—'}</span>
          </div>
          <button className="topbar-logout" onClick={onLogout} title="Se déconnecter">
            <LogOut size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  )
}
