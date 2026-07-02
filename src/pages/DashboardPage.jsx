import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  HeartPulse, Users, Wrench, Package, ShieldCheck,
  AlertTriangle, CalendarClock, Clock, User, MapPin,
  ArrowRight, ChevronRight,
  ChevronLeft, Plus, Activity, BatteryWarning, Zap,
  CircleDot,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLoadingBar } from '../hooks/useLoadingBar'
import { getDashboard } from '../api/dashboard'
import { getInstallations } from '../api/installations'

/* =====================================================================
 *  CielOo ERP — Dashboard (parc de défibrillateurs / DAE)
 *  Branché sur /api/dashboard (stats, activités, RDV à venir) et
 *  /api/installations (parc réel : conformité, batteries/électrodes).
 * ===================================================================== */

/* ── Accès rapides (statique) ── */
const SHORTCUTS = [
  { label: 'Planifier un contrôle', desc: 'Nouvel événement agenda', icon: CalendarClock, to: '/planning',      tone: 'orange' },
  { label: 'Nouvelle intervention', desc: 'Créer un ticket',          icon: Wrench,        to: '/interventions', tone: 'blue' },
  { label: 'Ajouter un DAE',        desc: 'Enregistrer un appareil',  icon: HeartPulse,    to: '/devices',       tone: 'green' },
  { label: 'Gérer le stock',        desc: 'Consommables & pièces',    icon: Package,       to: '/stock',         tone: 'purple' },
  { label: 'Nouveau client',        desc: 'Site ou collectivité',     icon: Users,         to: '/clients',       tone: 'teal' },
  { label: 'Voir le planning',      desc: 'Vue équipe complète',      icon: Activity,      to: '/planning',      tone: 'red' },
]

/* ── Types de rendez-vous (aligné sur Appointment.type côté back) ── */
const TYPE_META = {
  controle:     { label: 'Contrôle',     color: '#f97316', soft: '#fff3ea', icon: ShieldCheck },
  intervention: { label: 'Intervention', color: '#ef4444', soft: '#fdecec', icon: Wrench },
  installation: { label: 'Installation', color: '#22c55e', soft: '#e9f7ef', icon: Plus },
  formation:    { label: 'Formation',    color: '#a855f7', soft: '#f3e8ff', icon: Users },
  reunion:      { label: 'Réunion',      color: '#3b82f6', soft: '#eaf1fe', icon: CalendarClock },
  autre:        { label: 'Autre',        color: '#6b7280', soft: '#f1f3f6', icon: Activity },
}
const STATUS_META = {
  late:    { label: 'En retard',   cls: 'red' },
  today:   { label: "Aujourd'hui", cls: 'orange' },
  planned: { label: 'Planifié',    cls: 'blue' },
}
const ACTIVITY_TONE = { stock: 'teal', intervention: 'blue', appointment: 'purple' }
const AVATAR_PALETTE = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#14b8a6']

/* ── Helpers ── */
const initials = (name) => name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function avatarColor(name = '') {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
function daysUntil(d) {
  if (!d) return null
  return Math.round((new Date(d) - new Date()) / 86400000)
}
function apptStatus(start) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(startOfToday.getTime() + 86400000)
  if (start < now) return 'late'
  if (start >= startOfToday && start < endOfToday) return 'today'
  return 'planned'
}
function isCompliant(inst) {
  const now = new Date()
  const ctrl = inst.nextControl?.scheduledDate ? new Date(inst.nextControl.scheduledDate) : null
  const batt = inst.batteries?.[0]?.expiryDate ? new Date(inst.batteries[0].expiryDate) : null
  const elec = inst.electrodes?.[0]?.expiryDate ? new Date(inst.electrodes[0].expiryDate) : null
  return !((ctrl && ctrl < now) || (batt && batt < now) || (elec && elec < now))
}
function formatRelative(d) {
  const m = Math.floor((Date.now() - d.getTime()) / 60000)
  if (m < 1) return "À l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.floor(h / 24)} j`
}
function daysBadge(days) {
  if (days < 0) return { text: 'Expiré', cls: 'red' }
  if (days === 0) return { text: "Aujourd'hui", cls: 'red' }
  if (days <= 7) return { text: `J-${days}`, cls: 'amber' }
  return { text: `J-${days}`, cls: 'gray' }
}
function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/* ====================== Sous-composants ====================== */

function StatCard({ s, onClick }) {
  const ref = useRef(null)
  const handleMove = (e) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const Icon = s.icon
  return (
    <button
      ref={ref}
      className={`dfx-stat dfx-stat--${s.tone}`}
      onMouseMove={handleMove}
      onClick={onClick}
    >
      <span className="dfx-stat-glow" />
      <span className="dfx-stat-border" />
      <div className="dfx-stat-head">
        <span className="dfx-stat-icon"><Icon size={19} /></span>
      </div>
      <div className="dfx-stat-value">{s.value}</div>
      <div className="dfx-stat-label">{s.label}</div>
      <div className="dfx-stat-sub">{s.sub}</div>
    </button>
  )
}

function ConformityHero({ pct = 94, conformes = 322, total = 342, onClick }) {
  const r = 54
  const c = 2 * Math.PI * r
  const off = c * (1 - pct / 100)
  return (
    <div className="dfx-hero">
      <span className="dfx-hero-glow" />
      <svg className="dfx-hero-ecg" viewBox="0 0 400 60" preserveAspectRatio="none">
        <path className="dfx-ecg-base" pathLength="1000"
          d="M0,30 L128,30 L140,30 L146,18 L152,44 L158,4 L166,54 L172,30 L188,30 L400,30" />
        <path className="dfx-ecg-pulse" pathLength="1000"
          d="M0,30 L128,30 L140,30 L146,18 L152,44 L158,4 L166,54 L172,30 L188,30 L400,30" />
      </svg>

      <div className="dfx-hero-left">
        <span className="dfx-hero-eyebrow"><ShieldCheck size={13} /> Conformité du parc</span>
        <div className="dfx-hero-value">{pct}<span>%</span></div>
        <p className="dfx-hero-text">
          <strong>{conformes} DAE sur {total}</strong> conformes à la réglementation.
        </p>
        <button className="dfx-hero-btn" onClick={onClick}>
          <CalendarClock size={15} /> Planifier les contrôles
        </button>
      </div>

      <div className="dfx-hero-ring">
        <span className="dfx-ring-pulse" />
        <svg viewBox="0 0 128 128" width="128" height="128">
          <circle cx="64" cy="64" r={r} className="dfx-ring-track" />
          <circle cx="64" cy="64" r={r} className="dfx-ring-value"
            strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 64 64)" />
        </svg>
        <div className="dfx-ring-center">
          <strong>{conformes}</strong>
          <span>conformes</span>
        </div>
      </div>
    </div>
  )
}

function ControlRow({ c, onClick }) {
  const meta = TYPE_META[c.type] || TYPE_META.autre
  const Icon = meta.icon
  const st = STATUS_META[c.status]
  const urgent = c.status === 'late' || c.status === 'today'
  const day = c.start.toLocaleDateString('fr-FR', { day: '2-digit' })
  const month = c.start.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
  const time = c.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const techName = c.tech || 'Non assigné'
  return (
    <button className="dfx-ctrl" onClick={onClick} style={{ '--accent': meta.color, '--accent-soft': meta.soft }}>
      <span className="dfx-ctrl-date">
        <strong>{day}</strong>
        <span>{month}</span>
      </span>

      <span className={`dfx-ctrl-node${urgent ? ' is-urgent' : ''}`}>
        <Icon size={17} />
      </span>

      <div className="dfx-ctrl-body">
        <div className="dfx-ctrl-top">
          <span className="dfx-ctrl-title">{c.title}</span>
          <span className={`dfx-pill dfx-pill--${st.cls}`}>{st.label}</span>
        </div>
        <div className="dfx-ctrl-meta">
          <span><MapPin size={12} /> {c.client}</span>
        </div>
        <div className="dfx-ctrl-foot">
          <span className="dfx-ctrl-when"><Clock size={12} /> {time}</span>
          <span className="dfx-ctrl-tech">
            <span className="dfx-avatar" style={{ background: avatarColor(techName) }}>{initials(techName)}</span>
            {techName}
          </span>
        </div>
      </div>

      <ChevronRight size={17} className="dfx-ctrl-arrow" />
    </button>
  )
}

function EcheanceRow({ e }) {
  const Icon = e.icon
  const b = daysBadge(e.days)
  const pct = Math.max(0, Math.min(100, 100 - (Math.max(e.days, 0) / 30) * 100))
  return (
    <div className={`dfx-ech dfx-ech--${b.cls}`}>
      <span className={`dfx-ech-icon dfx-ech-icon--${e.kind}`}><Icon size={18} /></span>
      <div className="dfx-ech-body">
        <div className="dfx-ech-top">
          <span className="dfx-ech-label">{e.label}</span>
          <span className={`dfx-ech-badge dfx-ech-badge--${b.cls}`}>
            {b.cls === 'red' && <AlertTriangle size={11} />} {b.text}
          </span>
        </div>
        <div className="dfx-ech-sub">{e.ref} · {e.site}</div>
        <div className="dfx-ech-bar"><span className="dfx-ech-bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  )
}

/* Calendrier — piloté par `events` (prêt pour ton API agenda) */
function MiniCalendar({ events = [] }) {
  const now = new Date()
  const [view, setView] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const changeMonth = (delta) => setView(v => new Date(v.getFullYear(), v.getMonth() + delta, 1))

  const eventKeys = useMemo(() => new Set(events.map(e => dayKey(e.date))), [events])
  const y = view.getFullYear(), m = view.getMonth()
  const startIdx = (new Date(y, m, 1).getDay() + 6) % 7 // Lundi = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startIdx; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="dfx-cal">
      <div className="dfx-cal-head">
        <button className="dfx-cal-nav" onClick={() => changeMonth(-1)} aria-label="Mois précédent"><ChevronLeft size={15} /></button>
        <span className="dfx-cal-month">{view.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span>
        <button className="dfx-cal-nav" onClick={() => changeMonth(1)} aria-label="Mois suivant"><ChevronRight size={15} /></button>
      </div>
      <div className="dfx-cal-grid dfx-cal-dow">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="dfx-cal-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="dfx-cal-cell is-empty" />
          const isToday = d === now.getDate() && m === now.getMonth() && y === now.getFullYear()
          const hasEvent = eventKeys.has(`${y}-${m}-${d}`)
          return (
            <span key={i} className={`dfx-cal-cell${isToday ? ' is-today' : ''}${hasEvent ? ' has-event' : ''}`}>
              {d}
              {hasEvent && !isToday && <i className="dfx-cal-dot" />}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function ActivityRow({ a }) {
  return (
    <div className="dfx-act">
      <span className={`dfx-act-dot dfx-act-dot--${a.tone}`}><CircleDot size={10} /></span>
      <div className="dfx-act-body">
        <div className="dfx-act-top">
          <span className="dfx-act-action">{a.action}</span>
          <span className="dfx-act-detail">— {a.detail}</span>
        </div>
        <div className="dfx-act-meta">
          <span><User size={11} /> {a.user}</span>
          <span><Clock size={11} /> {formatRelative(a.date)}</span>
        </div>
      </div>
    </div>
  )
}

/* ============================ PAGE ============================ */

export default function DashboardPage() {
  const navigate = useNavigate()
  const go = (to) => navigate(to)
  const { user } = useAuth()

  const [data, setData] = useState(null)
  const [installations, setInstallations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useLoadingBar(loading)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true); setError('')
      try {
        const [dash, instRes] = await Promise.all([
          getDashboard(),
          getInstallations({ limit: 500 }).catch(() => ({ data: [] })),
        ])
        if (!alive) return
        setData(dash)
        setInstallations(instRes.data || [])
      } catch (err) {
        if (!alive) return
        const msg = formatApiError(err)
        setError(msg)
        toast.error(msg)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  const compliance = useMemo(() => {
    const total = installations.length
    if (!total) return { pct: 0, conformes: 0, total: 0 }
    const conformes = installations.filter(isCompliant).length
    return { pct: Math.round((conformes / total) * 100), conformes, total }
  }, [installations])

  const STATS = useMemo(() => {
    if (!data) return []
    const planned = installations.filter(i => i.nextControl?.scheduledDate).length
    const late = installations.filter(i => i.nextControl?.scheduledDate && new Date(i.nextControl.scheduledDate) < new Date()).length
    return [
      { key: 'parc',  label: 'DAE en parc',           value: String(data.stats.installations), sub: `${data.stats.clients} client${data.stats.clients > 1 ? 's' : ''} actifs`, icon: HeartPulse,    tone: 'orange' },
      { key: 'ctrl',  label: 'Contrôles à planifier', value: String(planned),                   sub: `${late} en retard`,                                                       icon: CalendarClock, tone: 'blue' },
      { key: 'inter', label: 'Interventions du mois', value: String(data.stats.interventionsThisMonth), sub: `${data.stats.interventionsPending} en attente`,                    icon: Wrench,        tone: 'purple' },
      { key: 'conf',  label: 'Taux de conformité',    value: `${compliance.pct} %`,             sub: 'parc réglementaire',                                                      icon: ShieldCheck,   tone: 'green' },
    ]
  }, [data, installations, compliance])

  const ALERTS = useMemo(() => {
    if (!installations.length) return []
    const now = new Date()
    const late = installations.filter(i => i.nextControl?.scheduledDate && new Date(i.nextControl.scheduledDate) < now).length
    let batteries = 0, electrodes = 0
    installations.forEach(inst => {
      ;(inst.batteries || []).forEach(b => { const d = daysUntil(b.expiryDate); if (d != null && d <= 30) batteries++ })
      ;(inst.electrodes || []).forEach(e => { const d = daysUntil(e.expiryDate); if (d != null && d < 0) electrodes++ })
    })
    return [
      { key: 'ctrl', count: late,       label: 'contrôles en retard',   icon: AlertTriangle,  tone: 'red',    to: '/planning' },
      { key: 'batt', count: batteries,  label: 'batteries à remplacer', icon: BatteryWarning, tone: 'amber',  to: '/devices' },
      { key: 'elec', count: electrodes, label: 'électrodes expirées',   icon: Zap,            tone: 'orange', to: '/devices' },
    ].filter(a => a.count > 0)
  }, [installations])

  const CONTROLES = useMemo(() => {
    if (!data) return []
    return data.upcomingAppointments.map(a => {
      const start = new Date(a.start)
      return {
        id: a._id,
        type: TYPE_META[a.type] ? a.type : 'autre',
        title: a.title || TYPE_META[a.type]?.label || 'Rendez-vous',
        client: a.clientName || '—',
        tech: a.assignedNames?.[0] || null,
        start,
        status: apptStatus(start),
      }
    })
  }, [data])

  const AGENDA_EVENTS = useMemo(() => CONTROLES.map(c => ({ date: c.start, type: c.type })), [CONTROLES])

  const ECHEANCES = useMemo(() => {
    const items = []
    installations.forEach(inst => {
      ;(inst.batteries || []).forEach((b, idx) => {
        const days = daysUntil(b.expiryDate)
        if (days == null || days > 30) return
        items.push({ id: `${inst._id}-b-${idx}`, kind: 'battery', label: b.productName || 'Batterie', ref: inst.deviceType || inst.serialNumber || '—', site: inst.clientName || '—', days, icon: BatteryWarning })
      })
      ;(inst.electrodes || []).forEach((e, idx) => {
        const days = daysUntil(e.expiryDate)
        if (days == null || days > 30) return
        items.push({ id: `${inst._id}-e-${idx}`, kind: 'electrode', label: e.productName || 'Électrodes', ref: inst.deviceType || inst.serialNumber || '—', site: inst.clientName || '—', days, icon: Zap })
      })
    })
    return items.sort((a, b) => a.days - b.days).slice(0, 6)
  }, [installations])

  const ACTIVITES = useMemo(() => {
    if (!data) return []
    return data.activities.map((a, i) => ({
      id: i,
      action: a.action,
      detail: a.detail,
      user: a.user || 'Système',
      date: new Date(a.date),
      tone: ACTIVITY_TONE[a.type] || 'blue',
    }))
  }, [data])

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Bonjour' : now.getHours() < 18 ? 'Bon après-midi' : 'Bonsoir'
  const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const displayName = user?.fullName || user?.username || ''

  if (loading) {
    return (
      <div className="dfx">
        <DashboardStyles />
        <div className="table-loading"><span className="spinner" /></div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="dfx">
        <DashboardStyles />
        <div className="table-error"><AlertTriangle size={15} /> {error}</div>
      </div>
    )
  }

  return (
    <div className="dfx">
      <DashboardStyles />

      {/* ── Header + alertes ── */}
      <header className="dfx-top">
        <div>
          <h1 className="dfx-title">{greeting}{displayName ? `, ${displayName}` : ''}</h1>
          <p className="dfx-date">{dateLabel}</p>
        </div>

        {ALERTS.length > 0 && (
          <div className="dfx-alerts">
            <span className="dfx-alerts-lead"><AlertTriangle size={15} /> Alertes du jour</span>
            {ALERTS.map(a => {
              const Icon = a.icon
              return (
                <button key={a.key} className={`dfx-alert dfx-alert--${a.tone}`} onClick={() => go(a.to)}>
                  <Icon size={14} /> <strong>{a.count}</strong> {a.label}
                  <ArrowRight size={13} className="dfx-alert-arrow" />
                </button>
              )
            })}
          </div>
        )}
      </header>

      {/* ── Cartes stats ── */}
      <section className="dfx-stats">
        {STATS.map(s => (
          <StatCard
            key={s.key}
            s={s}
            onClick={() => go(s.key === 'ctrl' ? '/planning' : s.key === 'inter' ? '/interventions' : '/devices')}
          />
        ))}
      </section>

      {/* ── Grille principale ── */}
      <div className="dfx-main">
        <div className="dfx-col">
          <ConformityHero pct={compliance.pct} conformes={compliance.conformes} total={compliance.total} onClick={() => go('/planning')} />

          <section className="dfx-card">
            <div className="dfx-card-head">
              <div className="dfx-card-title"><CalendarClock size={16} /> Prochains contrôles planifiés</div>
              <button className="dfx-link" onClick={() => go('/planning')}>Voir le planning <ArrowRight size={13} /></button>
            </div>
            <div className="dfx-ctrl-list">
              {CONTROLES.length > 0
                ? CONTROLES.map(c => <ControlRow key={c.id} c={c} onClick={() => go('/planning')} />)
                : <p className="dfx-empty">Aucun rendez-vous à venir.</p>}
            </div>
          </section>
        </div>

        <div className="dfx-col">
          <section className="dfx-card">
            <div className="dfx-card-head">
              <div className="dfx-card-title"><CalendarClock size={16} /> Calendrier</div>
            </div>
            <MiniCalendar events={AGENDA_EVENTS} />
            <div className="dfx-cal-legend">
              <span><i className="dot dot--today" /> Aujourd'hui</span>
              <span><i className="dot dot--event" /> Contrôle prévu</span>
            </div>
          </section>

          <section className="dfx-card dfx-card--glass">
            <span className="dfx-glass-blob dfx-glass-blob--b" />
            <div className="dfx-card-head">
              <div className="dfx-card-title"><BatteryWarning size={16} /> Échéances consommables</div>
              <button className="dfx-link" onClick={() => go('/stock')}>Stock <ArrowRight size={13} /></button>
            </div>
            <div className="dfx-ech-list">
              {ECHEANCES.length > 0
                ? ECHEANCES.map(e => <EcheanceRow key={e.id} e={e} />)
                : <p className="dfx-empty">Aucune échéance proche.</p>}
            </div>
          </section>
        </div>
      </div>

      {/* ── Bas de page ── */}
      <div className="dfx-bottom">
        <section className="dfx-card">
          <div className="dfx-card-head">
            <div className="dfx-card-title"><Activity size={16} /> Dernières activités</div>
          </div>
          <div className="dfx-act-list">
            {ACTIVITES.length > 0
              ? ACTIVITES.map(a => <ActivityRow key={a.id} a={a} />)
              : <p className="dfx-empty">Aucune activité récente.</p>}
          </div>
        </section>

        <section className="dfx-card dfx-card--glass">
          <span className="dfx-glass-blob dfx-glass-blob--d" />
          <div className="dfx-card-head">
            <div className="dfx-card-title"><Zap size={16} /> Accès rapides</div>
          </div>
          <div className="dfx-shortcuts">
            {SHORTCUTS.map(s => {
              const Icon = s.icon
              return (
                <button key={s.label} className={`dfx-shortcut dfx-shortcut--${s.tone}`} onClick={() => go(s.to)}>
                  <span className="dfx-shortcut-icon"><Icon size={19} /></span>
                  <span className="dfx-shortcut-label">{s.label}</span>
                  <span className="dfx-shortcut-desc">{s.desc}</span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

/* ====================== Styles (embarqués) ====================== */
function DashboardStyles() {
  return (
    <style>{`
    .dfx{
      --bg:#f6f7f9; --card:#fff; --border:#edeff2;
      --ink:#141a24; --ink2:#5b6472; --ink3:#98a1af;
      --orange:#f97316; --orange-d:#ea6a0d; --orange-soft:#fff3ea;
      --green:#16a34a; --green-soft:#e9f7ef;
      --red:#ef4444; --red-soft:#fdecec;
      --amber:#f59e0b; --amber-soft:#fff6e6;
      --blue:#3b82f6; --blue-soft:#eaf1fe;
      --purple:#7c5cff; --purple-soft:#f0ecff;
      --teal:#0d9488; --teal-soft:#e6f6f4;
      --gray-soft:#f1f3f6;
      --radius:20px; --radius-sm:14px;
      --shadow:0 1px 2px rgba(16,24,40,.04), 0 10px 28px rgba(16,24,40,.05);
      background:var(--bg); color:var(--ink);
      font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      padding: 24px 28px 80px 28px; display:flex; flex-direction:column; gap:20px;
      min-height:100%; box-sizing:border-box; overflow:auto;
    }
    .dfx *{ box-sizing:border-box; }
    .dfx button{ font-family:inherit; cursor:pointer; border:none; background:none; }

    /* ── Header ── */
    .dfx-top{ display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; }
    .dfx-title{ font-size:24px; font-weight:800; letter-spacing:-.02em; margin:0; }
    .dfx-date{ margin:4px 0 0; color:var(--ink2); font-size:13.5px; text-transform:capitalize; }

    /* ── Alerts strip ── */
    .dfx-alerts{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
    .dfx-alerts-lead{ display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--ink2); }
    .dfx-alert{ display:flex; align-items:center; gap:7px; padding:8px 12px; border-radius:11px; font-size:13px; font-weight:500; border:1px solid transparent; transition:transform .12s; }
    .dfx-alert:hover{ transform:translateY(-1px); }
    .dfx-alert strong{ font-weight:800; }
    .dfx-alert-arrow{ opacity:.55; }
    .dfx-alert--red{ background:var(--red-soft); color:#c0392b; border-color:#f7d3d3; }
    .dfx-alert--amber{ background:var(--amber-soft); color:#b57508; border-color:#f7e4bf; }
    .dfx-alert--orange{ background:var(--orange-soft); color:var(--orange-d); border-color:#fbdcc2; }

    /* ── Stats (lueur qui suit le curseur) ── */
    .dfx-stats{ display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
    .dfx-stat{
      --mx:50%; --my:50%;
      position:relative; overflow:hidden; text-align:left;
      background:var(--card); border:1px solid var(--border); border-radius:var(--radius);
      padding:18px; box-shadow:var(--shadow); transition:transform .16s, box-shadow .16s;
      display:flex; flex-direction:column; gap:2px;
    }
    .dfx-stat > *:not(.dfx-stat-glow):not(.dfx-stat-border){ position:relative; z-index:2; }
    .dfx-stat:hover{ transform:translateY(-3px); box-shadow:0 16px 38px rgba(16,24,40,.10); }
    .dfx-stat-glow{
      position:absolute; inset:0; z-index:0; opacity:0; transition:opacity .25s; pointer-events:none;
      background:radial-gradient(220px circle at var(--mx) var(--my), rgba(249,115,22,.16), transparent 62%);
    }
    .dfx-stat-border{
      position:absolute; inset:0; z-index:1; border-radius:var(--radius); pointer-events:none;
      opacity:0; transition:opacity .25s; padding:1px;
      background:radial-gradient(200px circle at var(--mx) var(--my), rgba(249,115,22,.65), transparent 60%);
      -webkit-mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite:xor; mask-composite:exclude;
    }
    .dfx-stat:hover .dfx-stat-glow, .dfx-stat:hover .dfx-stat-border{ opacity:1; }
    .dfx-stat-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .dfx-stat-icon{ width:42px; height:42px; border-radius:13px; display:grid; place-items:center; }
    .dfx-stat--orange .dfx-stat-icon{ background:var(--orange-soft); color:var(--orange); }
    .dfx-stat--blue   .dfx-stat-icon{ background:var(--blue-soft);   color:var(--blue); }
    .dfx-stat--purple .dfx-stat-icon{ background:var(--purple-soft); color:var(--purple); }
    .dfx-stat--green  .dfx-stat-icon{ background:var(--green-soft);  color:var(--green); }
    .dfx-trend{ display:flex; align-items:center; gap:3px; font-size:12px; font-weight:700; padding:4px 8px; border-radius:999px; }
    .dfx-trend.is-up{ background:var(--green-soft); color:var(--green); }
    .dfx-trend.is-down{ background:var(--red-soft); color:var(--red); }
    .dfx-stat-value{ font-size:29px; font-weight:800; letter-spacing:-.02em; }
    .dfx-stat-label{ font-size:13.5px; font-weight:600; margin-top:2px; }
    .dfx-stat-sub{ font-size:12px; color:var(--ink3); margin-top:2px; }

    /* ── Layout ── */
    .dfx-main, .dfx-bottom{ display:grid; grid-template-columns:1.7fr 1fr; gap:20px; align-items:start; }
    .dfx-col{ display:flex; flex-direction:column; gap:20px; }
    .dfx-card{ background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); }
    .dfx-card-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .dfx-card-title{ display:flex; align-items:center; gap:9px; font-size:15px; font-weight:700; }
    .dfx-card-title svg{ color:var(--orange); }
    .dfx-link{ display:flex; align-items:center; gap:4px; font-size:12.5px; font-weight:600; color:var(--orange-d); }
    .dfx-link:hover{ color:var(--orange); }
    .dfx-empty{ margin:0; padding:20px 4px; text-align:center; font-size:13px; color:var(--ink3); }

    /* ── Carte verre (glassmorphism) ── */
    .dfx-card--glass{
      position:relative; overflow:hidden; isolation:isolate;
      background:rgba(255,255,255,.55);
      border:1px solid rgba(255,255,255,.6);
      backdrop-filter:blur(22px) saturate(180%); -webkit-backdrop-filter:blur(22px) saturate(180%);
      box-shadow:0 1px 1px rgba(255,255,255,.6) inset, 0 18px 40px rgba(16,24,40,.10);
    }
    .dfx-card--glass .dfx-card-head,
    .dfx-card--glass .dfx-ech-list,
    .dfx-card--glass .dfx-shortcuts{ position:relative; z-index:1; }
    .dfx-glass-blob{ position:absolute; z-index:0; border-radius:50%; filter:blur(46px); pointer-events:none; }
    .dfx-glass-blob--b{
      bottom:-70px; left:-30px; width:200px; height:200px; background:rgba(249,115,22,.28);
      animation:blobRoam 16s ease-in-out infinite;
    }
    .dfx-glass-blob--c{
      top:-60px; left:-40px; width:220px; height:220px; background:rgba(249,115,22,.3);
      animation:blobRoam 18s ease-in-out infinite;
    }
    .dfx-glass-blob--d{
      bottom:-60px; right:-40px; width:220px; height:220px; background:rgba(124,92,255,.28);
      animation:blobRoam 20s ease-in-out infinite reverse;
    }
    @keyframes blobRoam{
      0%   { transform:translate(0, 0) scale(1); }
      25%  { transform:translate(70%, -40%) scale(1.15); }
      50%  { transform:translate(40%, 60%) scale(.9); }
      75%  { transform:translate(-20%, -20%) scale(1.05); }
      100% { transform:translate(0, 0) scale(1); }
    }
    @media (prefers-reduced-motion:reduce){
      .dfx-glass-blob--b, .dfx-glass-blob--c, .dfx-glass-blob--d{ animation:none; }
    }

    /* ── Hero conformité + animation ── */
    .dfx-hero{
      position:relative; overflow:hidden; border-radius:var(--radius); padding:26px 28px;
      color:#fff; display:flex; align-items:center; justify-content:space-between; gap:20px;
      background:linear-gradient(135deg,#ff8a3d 0%, #f97316 46%, #ea580c 100%);
      box-shadow:0 14px 36px rgba(234,88,12,.28);
    }
    .dfx-hero-glow{
      position:absolute; top:-70px; right:-50px; width:260px; height:260px; border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,.38),transparent 62%); pointer-events:none;
      animation:heroGlow 6s ease-in-out infinite;
    }
    @keyframes heroGlow{ 0%,100%{ transform:scale(1); opacity:.9 } 50%{ transform:scale(1.15); opacity:.6 } }
    .dfx-hero-ecg{ position:absolute; left:0; bottom:14px; width:100%; height:56px; opacity:.9; pointer-events:none; }
    .dfx-ecg-base{ fill:none; stroke:rgba(255,255,255,.28); stroke-width:2; }
    .dfx-ecg-pulse{ fill:none; stroke:#fff; stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round;
      stroke-dasharray:70 930; animation:ecg 2.6s linear infinite; filter:drop-shadow(0 0 4px rgba(255,255,255,.7)); }
    @keyframes ecg{ from{ stroke-dashoffset:1000 } to{ stroke-dashoffset:0 } }

    .dfx-hero-left{ position:relative; z-index:2; }
    .dfx-hero-eyebrow{ display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600;
      background:rgba(255,255,255,.22); padding:5px 11px; border-radius:999px; }
    .dfx-hero-value{ font-size:54px; font-weight:800; line-height:1; margin:14px 0 8px; letter-spacing:-.03em;
      text-shadow:0 2px 10px rgba(120,40,0,.25); }
    .dfx-hero-value span{ font-size:26px; font-weight:700; opacity:.9; }
    .dfx-hero-text{ font-size:13.5px; margin:0 0 18px; max-width:320px; color:#fff; line-height:1.5; }
    .dfx-hero-text strong{ font-weight:800; }
    .dfx-hero-btn{ display:inline-flex; align-items:center; gap:8px; background:#fff; color:var(--orange-d);
      padding:11px 18px; border-radius:12px; font-size:13.5px; font-weight:700; transition:transform .12s;
      opacity:0; pointer-events:none; }
    .dfx-hero-btn:hover{ transform:translateY(-1px); }
    .dfx-hero-ring{ position:relative; z-index:2; display:grid; place-items:center; }
    .dfx-ring-pulse{ position:absolute; width:128px; height:128px; border-radius:50%; border:2px solid rgba(255,255,255,.55);
      animation:ringPulse 2.6s ease-out infinite; }
    @keyframes ringPulse{ 0%{ transform:scale(.82); opacity:.7 } 100%{ transform:scale(1.15); opacity:0 } }
    .dfx-ring-track{ fill:none; stroke:rgba(255,255,255,.28); stroke-width:11; }
    .dfx-ring-value{ fill:none; stroke:#fff; stroke-width:11; stroke-linecap:round; transition:stroke-dashoffset 1s ease; }
    .dfx-ring-center{ position:absolute; text-align:center; }
    .dfx-ring-center strong{ display:block; font-size:26px; font-weight:800; }
    .dfx-ring-center span{ font-size:11px; opacity:.9; }

    /* ── Contrôles list (timeline) ── */
    .dfx-ctrl-list{ position:relative; display:flex; flex-direction:column; gap:6px; }
    .dfx-ctrl-list::before{
      content:''; position:absolute; left:91px; top:6px; bottom:6px; width:2px;
      background:repeating-linear-gradient(to bottom, var(--border) 0 5px, transparent 5px 10px);
      z-index:0;
    }
    .dfx-ctrl{
      position:relative; z-index:1; display:grid; grid-template-columns:56px 44px 1fr auto;
      align-items:center; gap:14px; text-align:left; width:100%;
      padding:12px 14px 12px 6px; border-radius:16px; border:1px solid transparent;
      background:var(--card); transition:transform .16s, box-shadow .16s, background .16s, border-color .16s;
    }
    .dfx-ctrl:hover{
      transform:translateY(-2px); border-color:var(--accent-soft);
      background:linear-gradient(0deg, var(--accent-soft), var(--accent-soft)), var(--card);
      box-shadow:0 14px 30px -10px rgba(16,24,40,.18);
    }
    .dfx-ctrl-date{
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
      width:56px; height:56px; border-radius:15px; background:var(--accent-soft); color:var(--accent);
      flex-shrink:0;
    }
    .dfx-ctrl-date strong{ font-size:18px; font-weight:800; line-height:1; }
    .dfx-ctrl-date span{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; opacity:.85; }
    .dfx-ctrl-node{
      position:relative; z-index:1; width:44px; height:44px; border-radius:50%; flex-shrink:0;
      display:grid; place-items:center; background:var(--accent); color:#fff;
      box-shadow:0 0 0 5px var(--card), 0 6px 16px -4px var(--accent);
      transition:transform .16s;
    }
    .dfx-ctrl:hover .dfx-ctrl-node{ transform:scale(1.08); }
    .dfx-ctrl-node.is-urgent::after{
      content:''; position:absolute; inset:-5px; border-radius:50%; border:2px solid var(--accent);
      opacity:.55; animation:nodePulse 2s ease-out infinite;
    }
    @keyframes nodePulse{ 0%{ transform:scale(.85); opacity:.6 } 100%{ transform:scale(1.35); opacity:0 } }
    .dfx-ctrl-body{ min-width:0; display:flex; flex-direction:column; gap:6px; }
    .dfx-ctrl-top{ display:flex; align-items:center; gap:10px; justify-content:space-between; }
    .dfx-ctrl-title{ font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .dfx-ctrl-meta{ font-size:12.5px; color:var(--ink2); }
    .dfx-ctrl-meta span{ display:inline-flex; align-items:center; gap:5px; }
    .dfx-ctrl-meta svg{ color:var(--ink3); }
    .dfx-ctrl-foot{ display:flex; align-items:center; gap:14px; font-size:12.5px; color:var(--ink2); flex-wrap:wrap; }
    .dfx-ctrl-when{ display:inline-flex; align-items:center; gap:5px; font-weight:600; color:var(--ink); }
    .dfx-ctrl-when svg{ color:var(--ink3); }
    .dfx-ctrl-tech{ display:inline-flex; align-items:center; gap:6px; }
    .dfx-avatar{ width:21px; height:21px; border-radius:50%; display:grid; place-items:center; font-size:9px; font-weight:700; color:#fff; }
    .dfx-ctrl-arrow{ color:var(--ink3); flex-shrink:0; transition:transform .16s, color .16s; }
    .dfx-ctrl:hover .dfx-ctrl-arrow{ transform:translateX(3px); color:var(--accent); }

    /* ── Pills ── */
    .dfx-pill{ font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; white-space:nowrap; }
    .dfx-pill--red{ background:var(--red-soft); color:var(--red); }
    .dfx-pill--orange{ background:var(--orange-soft); color:var(--orange-d); }
    .dfx-pill--blue{ background:var(--blue-soft); color:var(--blue); }
    .dfx-pill--amber{ background:var(--amber-soft); color:#b57508; }
    .dfx-pill--gray{ background:var(--gray-soft); color:var(--ink2); }

    /* ── Calendar ── */
    .dfx-cal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .dfx-cal-month{ font-size:13.5px; font-weight:700; text-transform:capitalize; }
    .dfx-cal-nav{ width:28px; height:28px; border-radius:8px; display:grid; place-items:center; color:var(--ink2); border:1px solid var(--border); transition:background .12s; }
    .dfx-cal-nav:hover{ background:var(--gray-soft); }
    .dfx-cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center; }
    .dfx-cal-dow span{ font-size:11px; font-weight:600; color:var(--ink3); padding:4px 0; }
    .dfx-cal-cell{ position:relative; height:34px; display:grid; place-items:center; font-size:12.5px; border-radius:9px; transition:background .12s; }
    .dfx-cal-cell.is-empty{ visibility:hidden; }
    .dfx-cal-cell.has-event:hover{ background:var(--orange-soft); }
    .dfx-cal-cell.is-today{ background:var(--orange); color:#fff; font-weight:700; box-shadow:0 4px 12px rgba(249,115,22,.4); }
    .dfx-cal-cell.has-event{ font-weight:700; }
    .dfx-cal-dot{ position:absolute; bottom:5px; width:5px; height:5px; border-radius:50%; background:var(--orange); }
    .dfx-cal-legend{ display:flex; gap:16px; margin-top:12px; font-size:11.5px; color:var(--ink2); }
    .dfx-cal-legend .dot{ display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
    .dfx-cal-legend .dot--today{ background:var(--orange); }
    .dfx-cal-legend .dot--event{ background:#fbdcc2; border:2px solid var(--orange); }

    /* ── Échéances (blocs verre) ── */
    .dfx-ech-list{ display:flex; flex-direction:column; gap:10px; }
    .dfx-ech{
      position:relative; display:flex; align-items:center; gap:14px; padding:13px 14px;
      border-radius:15px; background:rgba(255,255,255,.55); border:1px solid rgba(255,255,255,.65);
      backdrop-filter:blur(14px) saturate(160%); -webkit-backdrop-filter:blur(14px) saturate(160%);
      box-shadow:0 1px 1px rgba(255,255,255,.5) inset, 0 6px 18px rgba(16,24,40,.06);
      transition:transform .16s, box-shadow .16s, background .16s;
    }
    .dfx-ech:hover{
      transform:translateY(-2px); background:rgba(255,255,255,.72);
      box-shadow:0 1px 1px rgba(255,255,255,.6) inset, 0 14px 30px rgba(16,24,40,.12);
    }
    .dfx-ech-icon{
      width:40px; height:40px; border-radius:12px; display:grid; place-items:center; flex-shrink:0;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.5); transition:transform .18s;
    }
    .dfx-ech:hover .dfx-ech-icon{ transform:scale(1.08) rotate(-4deg); }
    .dfx-ech-icon--battery{ background:rgba(245,158,11,.18); color:var(--amber); }
    .dfx-ech-icon--electrode{ background:rgba(249,115,22,.16); color:var(--orange); }
    .dfx-ech-body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
    .dfx-ech-top{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .dfx-ech-label{ font-size:13.5px; font-weight:700; color:var(--ink); }
    .dfx-ech-sub{ font-size:12px; color:var(--ink3); }
    .dfx-ech-badge{ display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; white-space:nowrap; flex-shrink:0; }
    .dfx-ech-badge--red{ background:rgba(239,68,68,.16); color:var(--red); }
    .dfx-ech-badge--amber{ background:rgba(245,158,11,.18); color:#b57508; }
    .dfx-ech-badge--gray{ background:rgba(152,161,175,.16); color:var(--ink2); }
    .dfx-ech-bar{ height:5px; border-radius:999px; background:rgba(152,161,175,.2); overflow:hidden; }
    .dfx-ech-bar-fill{ display:block; height:100%; border-radius:999px; background:var(--ink3); transition:width .3s ease; }
    .dfx-ech--red .dfx-ech-bar-fill{ background:var(--red); }
    .dfx-ech--amber .dfx-ech-bar-fill{ background:var(--amber); }

    /* ── Activités ── */
    .dfx-act-list{ display:flex; flex-direction:column; }
    .dfx-act{ display:flex; gap:12px; padding:11px 6px; border-bottom:1px solid var(--border); }
    .dfx-act:last-child{ border-bottom:none; }
    .dfx-act-dot{ width:24px; height:24px; border-radius:8px; display:grid; place-items:center; flex-shrink:0; }
    .dfx-act-dot--green{ background:var(--green-soft); color:var(--green); }
    .dfx-act-dot--orange{ background:var(--orange-soft); color:var(--orange); }
    .dfx-act-dot--blue{ background:var(--blue-soft); color:var(--blue); }
    .dfx-act-dot--purple{ background:var(--purple-soft); color:var(--purple); }
    .dfx-act-dot--teal{ background:var(--teal-soft); color:var(--teal); }
    .dfx-act-body{ flex:1; min-width:0; }
    .dfx-act-top{ font-size:13px; }
    .dfx-act-action{ font-weight:600; }
    .dfx-act-detail{ color:var(--ink2); }
    .dfx-act-meta{ display:flex; gap:14px; margin-top:3px; font-size:11.5px; color:var(--ink3); }
    .dfx-act-meta span{ display:inline-flex; align-items:center; gap:4px; }

    /* ── Raccourcis (tuiles glassmorphism colorées) ── */
    .dfx-shortcuts{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    .dfx-shortcut{
      --tone: var(--orange); --tone-soft: rgba(249,115,22,.16); --tone-border: rgba(249,115,22,.32);
      position:relative; overflow:hidden; display:flex; flex-direction:column; align-items:flex-start; gap:10px;
      text-align:left; padding:16px 14px; border-radius:18px; color:var(--ink);
      background:var(--tone-soft); border:1px solid var(--tone-border);
      backdrop-filter:blur(14px) saturate(160%); -webkit-backdrop-filter:blur(14px) saturate(160%);
      box-shadow:0 1px 1px rgba(255,255,255,.5) inset, 0 8px 20px -10px rgba(16,24,40,.12);
      transition:transform .18s cubic-bezier(.2,.8,.3,1.2), box-shadow .18s, background .18s;
    }
    .dfx-shortcut::before{
      content:''; position:absolute; top:0px; right:0px; width:100%; height:100%;
      background:var(--tone-soft); filter:blur(4px); transition:transform .3s ease; pointer-events:none;
    }
    .dfx-shortcut:hover::before{ transform:scale(1.3) translate(-6px,6px); }
    .dfx-shortcut > *{ position:relative; z-index:1; }
    .dfx-shortcut:hover{
      transform:translateY(-4px) scale(1.02);
      box-shadow:0 1px 1px rgba(255,255,255,.6) inset, 0 16px 30px -10px rgba(16,24,40,.18);
    }
    .dfx-shortcut-icon{
      width:36px; height:36px; border-radius:11px; display:grid; place-items:center;
      background:var(--tone-soft); color:var(--tone); box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);
      transition:transform .18s;
    }
    .dfx-shortcut:hover .dfx-shortcut-icon{ transform:scale(1.1) rotate(-6deg); }
    .dfx-shortcut-label{ font-size:12.5px; font-weight:700; line-height:1.25; color:var(--ink); }
    .dfx-shortcut-desc{ font-size:10.5px; color:var(--ink2); line-height:1.3; }
    .dfx-shortcuts .dfx-shortcut--orange{ --tone:var(--orange); --tone-soft:rgba(249,115,22,.16); --tone-border:rgba(249,115,22,.32); }
    .dfx-shortcuts .dfx-shortcut--blue{   --tone:var(--blue);   --tone-soft:rgba(59,130,246,.16);  --tone-border:rgba(59,130,246,.32); }
    .dfx-shortcuts .dfx-shortcut--green{  --tone:var(--green);  --tone-soft:rgba(22,163,74,.16);   --tone-border:rgba(22,163,74,.32); }
    .dfx-shortcuts .dfx-shortcut--purple{ --tone:var(--purple); --tone-soft:rgba(124,92,255,.16);  --tone-border:rgba(124,92,255,.32); }
    .dfx-shortcuts .dfx-shortcut--teal{   --tone:var(--teal);   --tone-soft:rgba(13,148,136,.16);  --tone-border:rgba(13,148,136,.32); }
    .dfx-shortcuts .dfx-shortcut--red{    --tone:var(--red);    --tone-soft:rgba(239,68,68,.16);   --tone-border:rgba(239,68,68,.32); }

    /* ── Responsive ── */
    @media (max-width:1100px){
      .dfx-stats{ grid-template-columns:repeat(2,1fr); }
      .dfx-main, .dfx-bottom{ grid-template-columns:1fr; }
    }
    @media (max-width:640px){
      .dfx{ padding:18px 16px 32px; }
      .dfx-stats, .dfx-shortcuts{ grid-template-columns:1fr; }
      .dfx-hero{ flex-direction:column; align-items:flex-start; }
      .dfx-alerts{ justify-content:flex-start; }
      .dfx-ctrl{ grid-template-columns:44px 36px 1fr; gap:10px; }
      .dfx-ctrl-date{ width:44px; height:44px; border-radius:12px; }
      .dfx-ctrl-node{ width:36px; height:36px; }
      .dfx-ctrl-arrow{ display:none; }
      .dfx-ctrl-list::before{ left:70px; }
    }
    @media (prefers-reduced-motion:reduce){
      .dfx-hero-glow, .dfx-ecg-pulse, .dfx-ring-pulse{ animation:none; }
    }
    `}</style>
  )
}