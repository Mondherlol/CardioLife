import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Users, Wrench, Package,
  TrendingDown, AlertTriangle, CheckCircle2,
  ArrowRight, ShoppingCart, CalendarClock,
  Activity, Clock, User,
} from 'lucide-react'
import { getDashboard } from '../api/dashboard'

/* ── helpers ── */
function formatRelative(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'À l\'instant'
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7)  return `il y a ${d}j`
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/* Type colors (alignés sur le planning) */
const RDV_TYPE_COLORS = {
  controle: '#f97316', intervention: '#ef4444', installation: '#22c55e',
  formation: '#a855f7', reunion: '#3b82f6', autre: '#6b7280',
}

/* Libellé « quand » du RDV : Aujourd'hui / Demain / date courte + heure */
function formatRdvWhen(dateStr) {
  if (!dateStr) return '—'
  const d   = new Date(dateStr)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startToday) / 86400000)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (dayDiff === 0) return `Aujourd'hui ${time}`
  if (dayDiff === 1) return `Demain ${time}`
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

const ACTIVITY_META = {
  stock: {
    icon: Package,
    color: 'act--orange',
  },
  intervention: {
    icon: Wrench,
    color: 'act--blue',
  },
  appointment: {
    icon: CalendarClock,
    color: 'act--purple',
  },
}

/* ── Stat card ── */
function DashStatCard({ label, value, sub, icon: Icon, color, onClick }) {
  return (
    <button
      className={`dash-stat-card dash-stat-card--${color}${onClick ? ' dash-stat-card--clickable' : ''}`}
      onClick={onClick}
    >
      <div className="dash-stat-icon-wrap">
        <Icon size={20} />
      </div>
      <div className="dash-stat-body">
        <div className="dash-stat-value">{value ?? '—'}</div>
        <div className="dash-stat-label">{label}</div>
        {sub && <div className="dash-stat-sub">{sub}</div>}
      </div>
    </button>
  )
}

/* ── Activity row ── */
function ActivityRow({ item }) {
  const meta = ACTIVITY_META[item.type] || ACTIVITY_META.appointment
  const Icon = meta.icon
  return (
    <div className="act-row">
      <div className={`act-icon-wrap ${meta.color}`}>
        <Icon size={13} />
      </div>
      <div className="act-body">
        <div className="act-top">
          <span className="act-action">{item.action}</span>
          <span className="act-detail">— {item.detail}</span>
        </div>
        <div className="act-meta">
          {item.user && <span className="act-user"><User size={10} /> {item.user}</span>}
          <span className="act-time" title={formatDateTime(item.date)}>
            <Clock size={10} /> {formatRelative(item.date)}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Alert banner ── */
function StockAlertBanner({ lowStock, outOfStock, onClick }) {
  if (!lowStock && !outOfStock) return null
  return (
    <button className="dash-alert-banner" onClick={onClick}>
      <AlertTriangle size={15} />
      <span>
        {outOfStock > 0 && <><strong>{outOfStock} produit{outOfStock > 1 ? 's' : ''}</strong> épuisé{outOfStock > 1 ? 's' : ''}</>}
        {outOfStock > 0 && lowStock > 0 && ' · '}
        {lowStock > 0 && <><strong>{lowStock} produit{lowStock > 1 ? 's' : ''}</strong> en stock faible</>}
      </span>
      <ArrowRight size={13} className="dash-alert-arrow" />
    </button>
  )
}

/* ── Skeleton ── */
function Skeleton({ className }) {
  return <div className={`dash-skeleton ${className || ''}`} />
}

/* ── Page ── */
export default function DashboardPage() {
  const navigate = useNavigate()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(err => setError(err.message || 'Erreur de chargement.'))
      .finally(() => setLoading(false))
  }, [])

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Bonjour' : now.getHours() < 18 ? 'Bon après-midi' : 'Bonsoir'
  const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const s = data?.stats || {}

  return (
    <div className="page-content dash-page">
      {/* ── Header ── */}
      <div className="dash-header">
        <div>
          <h1 className="page-title">{greeting} 👋</h1>
          <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{dateLabel}</p>
        </div>
      </div>

      {/* ── Stock alert banner ── */}
      {!loading && (s.lowStock > 0 || s.outOfStock > 0) && (
        <StockAlertBanner
          lowStock={s.lowStock}
          outOfStock={s.outOfStock}
          onClick={() => navigate('/stock')}
        />
      )}

      {/* ── Stats grid ── */}
      <div className="dash-stats-grid">
        {loading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="dash-skeleton--stat" />)
        ) : error ? (
          <div className="dash-error"><AlertTriangle size={16} /> {error}</div>
        ) : (
          <>
            <DashStatCard
              label="DAE installés"
              value={s.installations}
              sub="dans tous les sites"
              icon={Monitor}
              color="blue"
              onClick={() => navigate('/installations')}
            />
            <DashStatCard
              label="Clients actifs"
              value={s.clients}
              sub="entreprises et collectivités"
              icon={Users}
              color="green"
              onClick={() => navigate('/clients')}
            />
            <DashStatCard
              label="Interventions ce mois"
              value={s.interventionsThisMonth}
              sub={s.interventionsPending > 0 ? `${s.interventionsPending} en attente` : 'À jour'}
              icon={Wrench}
              color={s.interventionsPending > 0 ? 'amber' : 'teal'}
              onClick={() => navigate('/interventions')}
            />
            <DashStatCard
              label="Références en stock"
              value={s.totalProducts}
              sub={s.lowStock > 0 ? `${s.lowStock} en stock faible` : 'Stock OK'}
              icon={Package}
              color={s.lowStock > 0 ? 'red' : 'purple'}
              onClick={() => navigate('/stock')}
            />
          </>
        )}
      </div>

      {/* ── RDV à venir ── */}
      {!loading && data?.upcomingAppointments?.length > 0 && (
        <div className="dash-panel dash-rdv-panel">
          <div className="dash-panel-header">
            <div className="dash-panel-title">
              <CalendarClock size={15} /> RDV à venir
            </div>
            <button className="dash-panel-link" onClick={() => navigate('/planning')}>
              Voir le planning <ArrowRight size={12} />
            </button>
          </div>
          <div className="dash-rdv-list">
            {data.upcomingAppointments.map(rdv => (
              <button key={rdv._id} className="dash-rdv-item" onClick={() => navigate('/planning')}>
                <span className="dash-rdv-dot" style={{ background: RDV_TYPE_COLORS[rdv.type] || '#6b7280' }} />
                <div className="dash-rdv-body">
                  <div className="dash-rdv-top">
                    <span className="dash-rdv-title">{rdv.title}</span>
                    {rdv.assignedToMe && <span className="dash-rdv-mine">Moi</span>}
                  </div>
                  <div className="dash-rdv-meta">
                    <span className="dash-rdv-when"><Clock size={10} /> {formatRdvWhen(rdv.start)}</span>
                    {rdv.clientName && <span className="dash-rdv-client">{rdv.clientName}</span>}
                    {!rdv.assignedToMe && rdv.assignedNames?.length > 0 && (
                      <span className="dash-rdv-assignee"><User size={10} /> {rdv.assignedNames[0]}{rdv.assignedNames.length > 1 ? ` +${rdv.assignedNames.length - 1}` : ''}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Bottom grid: activités ── */}
      <div className="dash-bottom-grid">

        {/* Dernières activités */}
        <div className="dash-panel dash-panel--activity">
          <div className="dash-panel-header">
            <div className="dash-panel-title">
              <Activity size={15} />
              Dernières activités
            </div>
          </div>

          {loading ? (
            <div className="act-list">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="dash-skeleton--act" />)}
            </div>
          ) : !data?.activities?.length ? (
            <div className="dash-empty">
              <CheckCircle2 size={28} color="var(--gray-300)" />
              <p>Aucune activité récente.</p>
            </div>
          ) : (
            <div className="act-list">
              {data.activities.map((item, i) => (
                <ActivityRow key={i} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Raccourcis rapides */}
        <div className="dash-panel dash-panel--shortcuts">
          <div className="dash-panel-header">
            <div className="dash-panel-title">
              <ShoppingCart size={15} />
              Accès rapides
            </div>
          </div>
          <div className="dash-shortcuts">
            {[
              { label: 'Nouvel client',        icon: Users,        path: '/clients',       color: 'green'  },
              { label: 'Nouvelle intervention', icon: Wrench,       path: '/interventions', color: 'blue'   },
              { label: 'Gérer le stock',        icon: Package,      path: '/stock',         color: 'orange' },
              { label: 'Planning',              icon: CalendarClock,path: '/planning',      color: 'purple' },
              { label: 'Sites installés',       icon: Monitor,      path: '/installations', color: 'teal'   },
              { label: 'Stock en alerte',       icon: TrendingDown, path: '/stock',         color: 'red'    },
            ].map(({ label, icon: Icon, path, color }) => (
              <button
                key={label}
                className={`dash-shortcut dash-shortcut--${color}`}
                onClick={() => navigate(path)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
