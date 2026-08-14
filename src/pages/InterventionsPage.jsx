import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wrench, Plus, Search, X, CheckCircle2,
  Clock, AlertCircle, Calendar, MapPin, Zap, User,
  ChevronDown, AlertTriangle, ArrowRight, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import { getInterventions } from '../api/interventions'
import { get } from '../api/http'
import ControlCreateModal from '../components/ControlCreateModal'
import InstallationCompleteModal from '../components/InstallationCompleteModal'
import { getInstallations } from '../api/installations'

/* ─── Constants ─────────────────────────────────────────────── */

const STATUS_META = {
  planifie:  { label: 'Planifié',   cls: 'iv-badge iv-badge--blue',   Icon: Clock        },
  en_cours:  { label: 'En cours',   cls: 'iv-badge iv-badge--orange', Icon: AlertCircle  },
  termine:   { label: 'Terminé',    cls: 'iv-badge iv-badge--green',  Icon: CheckCircle2 },
}

const CONTROL_TYPE_META = {
  semestriel:   { label: 'Semestriel',   cls: 'ct-type-badge ct-type-badge--semestriel' },
  annuel:       { label: 'Annuel',       cls: 'ct-type-badge ct-type-badge--annuel' },
  hors_contrat: { label: 'Hors contrat', cls: 'ct-type-badge ct-type-badge--hors' },
}
const CONTROL_TYPE_OPTS = [
  { value: 'hors_contrat', label: 'Hors contrat' },
  { value: 'semestriel',   label: 'Semestriel' },
  { value: 'annuel',       label: 'Annuel' },
]
function ControlTypeBadge({ type }) {
  const m = CONTROL_TYPE_META[type] || CONTROL_TYPE_META.hors_contrat
  return <span className={m.cls}>{m.label}</span>
}

/* ─── Helpers ────────────────────────────────────────────────── */

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* ─── StatusBadge ────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.planifie
  const { Icon } = meta
  return (
    <span className={meta.cls}>
      <Icon size={11} strokeWidth={2.5} />
      {meta.label}
    </span>
  )
}

/* ─── Create Modal ───────────────────────────────────────────── */

/* ─── Date grouping ──────────────────────────────────────────── */
function groupInterventions(interventions) {
  const now       = new Date(); now.setHours(0,0,0,0)
  const tomorrow  = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const endWeek   = new Date(now); endWeek.setDate(now.getDate() + 7)
  const endNxtWk  = new Date(now); endNxtWk.setDate(now.getDate() + 14)

  const groups = {
    retard:    { key: 'retard',    label: 'En retard',            accent: 'red',    items: [] },
    today:     { key: 'today',     label: "Aujourd'hui",          accent: 'orange', items: [] },
    demain:    { key: 'demain',    label: 'Demain',               accent: 'amber',  items: [] },
    semaine:   { key: 'semaine',   label: 'Cette semaine',        accent: 'blue',   items: [] },
    prochaine: { key: 'prochaine', label: 'La semaine prochaine', accent: 'gray',   items: [] },
    // Tout le reste du calendrier, sans horizon : c'est la vue d'ensemble.
    plus_tard: { key: 'plus_tard', label: 'À venir plus tard',    accent: 'gray',   items: [] },
    termine:   { key: 'termine',   label: 'Terminées',            accent: 'green',  items: [] },
  }

  for (const iv of interventions) {
    if (iv.status === 'termine') { groups.termine.items.push(iv); continue }
    const d = iv.scheduledDate ? new Date(iv.scheduledDate) : null
    if (!d) { groups.plus_tard.items.push(iv); continue }
    const day = new Date(d); day.setHours(0,0,0,0)
    if      (day < now)          groups.retard.items.push(iv)
    else if (+day === +now)      groups.today.items.push(iv)
    else if (+day === +tomorrow) groups.demain.items.push(iv)
    else if (day < endWeek)      groups.semaine.items.push(iv)
    else if (day < endNxtWk)     groups.prochaine.items.push(iv)
    else                         groups.plus_tard.items.push(iv)
  }

  /* Dans chaque section, l'échéance la plus proche vient en tête — sauf pour
     les contrôles faits, où c'est le dernier réalisé qui intéresse. Sans ce
     tri, l'ordre était celui de l'API, donc arbitraire à l'œil du technicien. */
  const byDateAsc = (a, b) =>
    new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0)

  for (const g of Object.values(groups)) {
    g.items.sort(g.key === 'termine' ? (a, b) => byDateAsc(b, a) : byDateAsc)
  }

  return Object.values(groups).filter(g => g.items.length > 0)
}

/* ─── Technician Card ────────────────────────────────────────── */
function TechnicianCard({ intervention, onClick }) {
  const snap   = intervention.installationSnap || {}
  const status = intervention.status
  const isDone = status === 'termine'
  const isLate = status !== 'termine' && intervention.scheduledDate &&
    new Date(intervention.scheduledDate) < new Date(new Date().setHours(0,0,0,0))

  return (
    <div
      className={`iv-card iv-card--clickable${isDone ? ' iv-card--done' : ''}${isLate ? ' iv-card--late' : ''}`}
      onClick={onClick}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className="iv-card-header">
        <div className="iv-card-client">{intervention.clientName || '—'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ControlTypeBadge type={intervention.controlType} />
          <StatusBadge status={intervention.status} />
          <ArrowRight size={14} className="iv-card-arrow" />
        </div>
      </div>

      <div className="iv-card-body">
        <div className="iv-card-row">
          <Zap size={13} strokeWidth={1.8} />
          <span>
            {snap.deviceType || '—'}
            {snap.serialNumber && <> · <code>{snap.serialNumber}</code></>}
          </span>
        </div>
        {(snap.address || snap.location) && (
          <div className="iv-card-row">
            <MapPin size={13} strokeWidth={1.8} />
            <span>{snap.address}{snap.location ? ` — ${snap.location}` : ''}</span>
          </div>
        )}
        <div className="iv-card-row">
          <Calendar size={13} strokeWidth={1.8} />
          <span className={isLate ? 'iv-card-date--late' : ''}>
            {isLate ? 'Prévu le ' : 'Planifié le '}{fmt(intervention.scheduledDate)}
            {isLate && <AlertTriangle size={11} style={{ marginLeft: 4, color: 'var(--red-500)' }} />}
          </span>
        </div>
        {isDone && intervention.completedDate && (
          <div className="iv-card-row iv-card-row--done">
            <CheckCircle2 size={13} strokeWidth={1.8} />
            <span>Réalisé le {fmt(intervention.completedDate)}</span>
          </div>
        )}
        {intervention.notes && (
          <p className="iv-card-notes">{intervention.notes}</p>
        )}
      </div>
    </div>
  )
}

/* ─── Installations à poser (vue technicien) ─────────────────── */

/**
 * Les poses assignées au technicien, avant ses contrôles : du matériel attend
 * d'être mis en service, c'est ce qui bloque le client.
 */
function PosesSection({ poses, onPick }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="iv-date-section">
      <button className="iv-date-section-hdr" onClick={() => setOpen(o => !o)}>
        <span className="iv-date-section-dot" style={{ background: 'var(--purple-500, #7c5cff)' }} />
        <span className="iv-date-section-label">Installations à réaliser</span>
        <span className="iv-date-section-count">{poses.length}</span>
        <ChevronDown size={14} className={`iv-date-section-chevron${open ? ' iv-date-section-chevron--open' : ''}`} />
      </button>

      {open && (
        <div className="iv-cards-grid">
          {poses.map(p => {
            const late = p.scheduledDate &&
              new Date(p.scheduledDate) < new Date(new Date().setHours(0, 0, 0, 0))
            return (
              <div key={p._id} className={`iv-card iv-card--pose${late ? ' iv-card--late' : ''}`}>
                <div className="iv-card-header">
                  <div className="iv-card-client">{p.clientName || '—'}</div>
                  <span className="pose-badge">À installer</span>
                </div>

                <div className="iv-card-body">
                  <div className="iv-card-row">
                    <Zap size={13} strokeWidth={1.8} />
                    <span>
                      {p.deviceType || 'DAE'}
                      {p.serialNumber && <> · <code>{p.serialNumber}</code></>}
                    </span>
                  </div>
                  {(p.address || p.location) && (
                    <div className="iv-card-row">
                      <MapPin size={13} strokeWidth={1.8} />
                      <span>{p.address}{p.location ? ` — ${p.location}` : ''}</span>
                    </div>
                  )}
                  <div className="iv-card-row">
                    <Calendar size={13} strokeWidth={1.8} />
                    <span className={late ? 'iv-card-date--late' : ''}>
                      Prévue le {fmt(p.scheduledDate)}
                      {late && <AlertTriangle size={11} style={{ marginLeft: 4, color: 'var(--red-500)' }} />}
                    </span>
                  </div>
                  {p.notes && <p className="iv-card-notes">{p.notes}</p>}
                </div>

                <div className="iv-card-foot">
                  <button className="btn btn--primary btn--sm" onClick={() => onPick(p)}>
                    <CheckCircle2 size={13} /> Compte rendu de pose
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Date section ───────────────────────────────────────────── */
function DateSection({ group, onCardClick, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const count = group.items.length
  const accentVar = `var(--${group.accent === 'gray' ? 'gray' : group.accent}-${group.accent === 'gray' ? '400' : '500'})`

  return (
    <div className="iv-date-section">
      <button
        className="iv-date-section-hdr"
        onClick={() => setOpen(o => !o)}
      >
        <span className="iv-date-section-dot" style={{ background: accentVar }} />
        <span className="iv-date-section-label">{group.label}</span>
        <span className="iv-date-section-count">{count}</span>
        <ChevronDown size={14} className={`iv-date-section-chevron${open ? ' iv-date-section-chevron--open' : ''}`} />
      </button>
      {open && (
        <div className="iv-cards-grid">
          {group.items.map(iv => (
            <TechnicianCard
              key={iv._id}
              intervention={iv}
              onClick={() => onCardClick(iv._id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Admin Table Row ────────────────────────────────────────── */

function AdminRow({ intervention, onClick }) {
  const snap = intervention.installationSnap || {}
  return (
    <tr onClick={onClick} style={{ cursor: 'pointer' }}>
      <td>
        <div className="inst-site-cell">
          <div className="inst-site-client">{intervention.clientName || '—'}</div>
          {(snap.address || snap.location) && (
            <div className="inst-site-loc">
              <MapPin size={11} strokeWidth={1.8} />
              {snap.address}{snap.location ? ` · ${snap.location}` : ''}
            </div>
          )}
        </div>
      </td>
      <td>
        <div className="inst-device-cell">
          {snap.deviceType   && <span className="inst-device-type">{snap.deviceType}</span>}
          {snap.serialNumber && <span className="inst-device-sn">{snap.serialNumber}</span>}
          {!snap.deviceType && !snap.serialNumber && <span className="text-muted">—</span>}
        </div>
      </td>
      <td>
        <div className="iv-tech-cell">
          <User size={12} strokeWidth={1.8} />
          {intervention.technicienName || intervention.technicien?.fullName || <em className="text-muted">Non assigné</em>}
        </div>
      </td>
      <td>
        <div className="iv-date-cell">
          <Calendar size={12} strokeWidth={1.8} />
          {fmt(intervention.scheduledDate)}
        </div>
      </td>
      <td>
        {intervention.status === 'termine' && intervention.completedDate
          ? <div className="iv-date-cell"><CheckCircle2 size={12} strokeWidth={1.8} />{fmt(intervention.completedDate)}</div>
          : <span className="text-muted">—</span>
        }
      </td>
      <td><ControlTypeBadge type={intervention.controlType} /></td>
      <td><StatusBadge status={intervention.status} /></td>
    </tr>
  )
}

/* ─── Main Page ──────────────────────────────────────────────── */

const STATUS_FILTERS = [
  { value: '',         label: 'Toutes' },
  { value: 'planifie', label: 'Planifiées' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine',  label: 'Terminées' },
]

const PAGE_SIZE = 100

/* `embedded` : monté comme onglet de la page Maintenance — le titre de la page
   porte déjà le contexte, seul le sous-titre et les actions restent. */
export default function InterventionsPage({ embedded = false }) {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const isTech   = user?.role === 'technicien'
  const canManage = user?.role === 'superadmin' || user?.role === 'admin'
    || user?.permissions?.canManageInterventions

  const [all, setAll]             = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [sortDir, setSortDir]     = useState('desc')  // tri par date planifiée
  const [page, setPage]           = useState(1)
  // Poses assignées au technicien : elles précèdent les contrôles, c'est du
  // matériel qui attend d'être mis en service.
  const [poses, setPoses]         = useState([])
  const [posing, setPosing]       = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getInterventions()
      setAll(Array.isArray(data) ? data : [])
    } catch (err) {
      toast.error(err.message || 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPoses = useCallback(async () => {
    if (!isTech) return
    try {
      const res = await getInstallations({ status: 'a_installer', limit: 100 })
      const list = Array.isArray(res) ? res : (res?.data || [])
      setPoses(list.sort((a, b) =>
        new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0)))
    } catch { /* la page reste utilisable sans les poses */ }
  }, [isTech])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { fetchPoses() }, [fetchPoses])
  useEffect(() => { setPage(1) }, [search, statusFilter, sortDir])

  const filtered = useMemo(() => {
    let list = all
    if (statusFilter) list = list.filter(i => i.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.clientName?.toLowerCase().includes(q) ||
        i.technicienName?.toLowerCase().includes(q) ||
        i.installationSnap?.deviceType?.toLowerCase().includes(q) ||
        i.installationSnap?.serialNumber?.toLowerCase().includes(q) ||
        i.installationSnap?.address?.toLowerCase().includes(q)
      )
    }
    return list
  }, [all, statusFilter, search])

  // Tri par date planifiée (par défaut la plus récente d'abord) + pagination
  const sortedFiltered = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const ta = a.scheduledDate ? new Date(a.scheduledDate).getTime() : null
      const tb = b.scheduledDate ? new Date(b.scheduledDate).getTime() : null
      if (ta == null && tb == null) return 0
      if (ta == null) return 1     // sans date planifiée en dernier
      if (tb == null) return -1
      return (ta - tb) * dir
    })
  }, [filtered, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / PAGE_SIZE))
  const pageItems  = sortedFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => ({
    total:    all.length,
    planifie: all.filter(i => i.status === 'planifie').length,
    en_cours: all.filter(i => i.status === 'en_cours').length,
    termine:  all.filter(i => i.status === 'termine').length,
  }), [all])

  const pendingCount = isTech ? all.filter(i => i.status !== 'termine').length : null

  const groupedSections = useMemo(() => {
    if (!isTech) return []
    return groupInterventions(filtered)
  }, [isTech, filtered])

  function onCreated(created) {
    setAll(prev => [created, ...prev])
  }

  return (
    <div className={embedded ? 'mt-tab-panel' : 'page-content'}>
      {/* Header */}
      <div className="page-header">
        <div>
          {!embedded && (
            <h1 className="page-title">
              <Wrench size={20} strokeWidth={1.8} /> Contrôles
            </h1>
          )}
          {isTech ? (
            <p className="page-subtitle">
              Bonjour <strong>{user.fullName || user.username}</strong> —
              {pendingCount > 0
                ? <> <span className="iv-pending-count">{pendingCount}</span> contrôle{pendingCount > 1 ? 's' : ''} en attente</>
                : <> Tous vos contrôles sont à jour</>
              }
            </p>
          ) : (
            <p className="page-subtitle">{all.length} contrôle{all.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        {canManage && (
          <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Nouveau contrôle
          </button>
        )}
      </div>

      {/* Stats (admin only) */}
      {!isTech && (
        <div className="inst-stats">
          <div className="inst-stat-card">
            <div className="inst-stat-num">{stats.total}</div>
            <div className="inst-stat-label">Total</div>
          </div>
          <div className="inst-stat-card inst-stat-card--blue">
            <div className="inst-stat-num">{stats.planifie}</div>
            <div className="inst-stat-label">Planifiées</div>
          </div>
          <div className="inst-stat-card inst-stat-card--amber">
            <div className="inst-stat-num">{stats.en_cours}</div>
            <div className="inst-stat-label">En cours</div>
          </div>
          <div className="inst-stat-card inst-stat-card--green">
            <div className="inst-stat-num">{stats.termine}</div>
            <div className="inst-stat-label">Terminées</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Client, technicien, appareil, n° de série…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>
        <div className="inst-status-filters">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              className={`inst-filter-btn${statusFilter === f.value ? ' inst-filter-btn--active' : ''}`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
              {f.value && (
                <span className="inst-filter-count">
                  {stats[f.value] ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : isTech ? (
        filtered.length === 0 ? (
          <div className="iv-dashboard">
            {poses.length > 0 && <PosesSection poses={poses} onPick={setPosing} />}
            <div className="table-empty" style={{ padding: '48px 0', textAlign: 'center' }}>
              {search || statusFilter
                ? 'Aucune intervention pour ces critères.'
                : 'Aucun contrôle ne vous est assigné.'}
            </div>
          </div>
        ) : groupedSections.length === 0 ? (
          <div className="table-empty" style={{ padding: '48px 0', textAlign: 'center' }}>
            Aucune intervention pour ces critères.
          </div>
        ) : (
          <div className="iv-dashboard">
            {poses.length > 0 && <PosesSection poses={poses} onPick={setPosing} />}
            {groupedSections.map(g => (
              <DateSection
                key={g.key}
                group={g}
                onCardClick={id => navigate(`/interventions/${id}`)}
                // « À venir plus tard » s'ouvre : c'est la vue d'ensemble du
                // calendrier, elle n'a d'intérêt que dépliée.
                defaultOpen={g.key !== 'termine'}
              />
            ))}
          </div>
        )
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client / Site</th>
                <th>DAE</th>
                <th>Technicien</th>
                <th onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title="Trier par date planifiée">
                  Planifié <span style={{ color: 'var(--orange-500)', fontSize: 10 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                </th>
                <th>Réalisé</th>
                <th>Type de contrôle</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(iv => (
                <AdminRow
                  key={iv._id}
                  intervention={iv}
                  onClick={() => navigate(`/interventions/${iv._id}`)}
                />
              ))}
              {sortedFiltered.length === 0 && (
                <tr><td colSpan={7} className="table-empty">
                  {search || statusFilter
                    ? 'Aucun résultat pour ces critères.'
                    : 'Aucun contrôle enregistré.'}
                </td></tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={15} />
              </button>
              <span className="pag-info">Page {page} / {totalPages} · {sortedFiltered.length} contrôle{sortedFiltered.length !== 1 ? 's' : ''}</span>
              <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <ControlCreateModal onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}

      {posing && (
        <InstallationCompleteModal
          installation={posing}
          onClose={() => setPosing(null)}
          onDone={() => { setPosing(null); fetchPoses() }}
        />
      )}
    </div>
  )
}
