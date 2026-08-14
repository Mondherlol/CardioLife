import { useMemo } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { Wrench, HeartPulse, GraduationCap, Replace } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import InterventionsPage from './InterventionsPage'
import ReplacementsPage  from './ReplacementsPage'
import FormationsPage    from './FormationsPage'
import InstallationsTab  from '../components/InstallationsTab'

/**
 * Tout le suivi terrain d'un parc au même endroit : les contrôles, les poses,
 * les formations dispensées et les pièces à remplacer. Ces quatre volets se
 * répondent — on ne consulte pas l'un sans regarder les autres — d'où l'onglet
 * unique plutôt que quatre entrées de menu.
 *
 * Chaque volet reste une page autonome, montée ici en mode `embedded` : son
 * titre disparaît au profit de celui de la page, ses actions restent.
 */
const TABS = [
  {
    id: 'controles', label: 'Contrôles', icon: Wrench,
    can: () => true,
  },
  {
    id: 'installations', label: 'Installations', icon: HeartPulse,
    can: u => ['superadmin', 'admin', 'technicien'].includes(u?.role) || !!u?.permissions?.canManageDevices,
  },
  {
    id: 'formations', label: 'Formations', icon: GraduationCap,
    can: u => u?.role === 'superadmin'
      || !!u?.permissions?.canManageFormations || !!u?.permissions?.canManageClients,
  },
  {
    id: 'remplacements', label: 'Remplacements', icon: Replace,
    can: u => ['superadmin', 'admin', 'commercial', 'assistante'].includes(u?.role),
  },
]

export default function MaintenancePage() {
  const { tab }  = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const allowed = useMemo(() => TABS.filter(t => t.can(user)), [user])
  const active  = allowed.find(t => t.id === tab)

  // Onglet inconnu ou interdit : on retombe sur le premier accessible.
  if (!active) return <Navigate to={`/maintenance/${allowed[0].id}`} replace />

  return (
    <div className="page-content">
      <div className="page-header page-header--tight">
        <h1 className="page-title"><Wrench size={20} strokeWidth={1.8} /> Maintenance</h1>
      </div>

      <div className="mt-tabs">
        {allowed.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              className={`mt-tab${t.id === active.id ? ' mt-tab--active' : ''}`}
              onClick={() => navigate(`/maintenance/${t.id}`)}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {active.id === 'controles'     && <InterventionsPage embedded />}
      {active.id === 'installations' && <InstallationsTab  embedded />}
      {active.id === 'formations'    && <FormationsPage    embedded />}
      {active.id === 'remplacements' && <ReplacementsPage  embedded />}
    </div>
  )
}
