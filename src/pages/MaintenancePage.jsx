import { useMemo } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { Wrench, HeartPulse, GraduationCap, Replace } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isAdmin } from '../lib/access'
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
/* Chaque volet suit la permission qui le concerne, et rien d'autre — cocher
   « Gérer les formations » n'ouvre pas les contrôles, et le rôle Technicien ne
   donne plus d'accès en dur : c'est bien la case qui décide. */
const has = (u, perm) => isAdmin(u) || !!u?.permissions?.[perm]

const TABS = [
  {
    id: 'controles', label: 'Contrôles', icon: Wrench,
    can: u => has(u, 'canManageInterventions'),
  },
  {
    id: 'installations', label: 'Installations', icon: HeartPulse,
    can: u => has(u, 'canManageDevices'),
  },
  {
    id: 'formations', label: 'Formations', icon: GraduationCap,
    can: u => has(u, 'canManageFormations') || has(u, 'canManageClients'),
  },
  {
    id: 'remplacements', label: 'Remplacements', icon: Replace,
    can: u => has(u, 'canManageInterventions') || has(u, 'canManageDevices'),
  },
]

export default function MaintenancePage() {
  const { tab }  = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const allowed = useMemo(() => TABS.filter(t => t.can(user)), [user])
  const active  = allowed.find(t => t.id === tab)

  // Onglet inconnu ou interdit : on retombe sur le premier accessible.
  if (!allowed.length) return <Navigate to="/planning" replace />
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
