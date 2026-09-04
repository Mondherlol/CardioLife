import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  HeartPulse, Search, X, MapPin, User, Calendar, CheckCircle2,
  Clock, AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { getInstallations } from '../api/installations'
import InstallationCompleteModal from './InstallationCompleteModal'
import { useAuth } from '../context/AuthContext'
import { isAdmin } from '../lib/access'

/* Le parc ne connaît que deux statuts : « à installer » et « installé ».
   L'état « en cours » se déduit de la date de pose : une pose dont le jour est
   arrivé (ou dépassé) est en cours de traitement chez le technicien, tant que
   son compte rendu n'a pas été validé. */
const BUCKETS = {
  a_faire:  { label: 'À faire',  cls: 'iv-badge iv-badge--blue',   Icon: Clock },
  en_cours: { label: 'En cours', cls: 'iv-badge iv-badge--orange', Icon: AlertTriangle },
  faite:    { label: 'Faite',    cls: 'iv-badge iv-badge--green',  Icon: CheckCircle2 },
}

function bucketOf(inst) {
  if (inst.status === 'installe') return 'faite'
  if (!inst.scheduledDate) return 'a_faire'
  const day = new Date(inst.scheduledDate); day.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return day <= today ? 'en_cours' : 'a_faire'
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function BucketBadge({ bucket }) {
  const m = BUCKETS[bucket]
  const { Icon } = m
  return <span className={m.cls}><Icon size={11} strokeWidth={2.5} /> {m.label}</span>
}

const FILTERS = [
  { value: '',         label: 'Toutes' },
  { value: 'a_faire',  label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'faite',    label: 'Faites' },
]

const PAGE_SIZE = 100

/**
 * Le parc vu sous l'angle du travail à faire : ce qui reste à poser, ce qui est
 * en cours de pose et ce qui est en service.
 */
export default function InstallationsTab({ embedded = false }) {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  // Le rôle Technicien ne donne plus d'accès en dur : c'est la case
  // « Gérer les appareils » qui décide, comme partout ailleurs.
  const canReport = isAdmin(user) || !!user?.permissions?.canManageDevices

  const [all, setAll]         = useState([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied]   = useState(false)
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState('')
  const [page, setPage]       = useState(1)
  const [posing, setPosing]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await getInstallations({ limit: 1000 })
      const list = Array.isArray(res) ? res : (res?.data || [])
      setAll(list)
      setDenied(false)
    } catch (err) {
      // Les profils sans droit sur le parc gardent les autres onglets.
      if (err.status === 403) setDenied(true)
      else toast.error(err.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filter])

  const rows = useMemo(() => all.map(i => ({ ...i, bucket: bucketOf(i) })), [all])

  const stats = useMemo(() => ({
    total:    rows.length,
    a_faire:  rows.filter(r => r.bucket === 'a_faire').length,
    en_cours: rows.filter(r => r.bucket === 'en_cours').length,
    faite:    rows.filter(r => r.bucket === 'faite').length,
  }), [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filter) list = list.filter(r => r.bucket === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(r =>
        r.clientName?.toLowerCase().includes(q) ||
        r.address?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        r.deviceType?.toLowerCase().includes(q) ||
        r.serialNumber?.toLowerCase().includes(q) ||
        r.technicianName?.toLowerCase().includes(q)
      )
    }
    /* Les poses en attente d'abord, la plus urgente en tête : c'est ce qui
       demande une action. Le parc installé suit, le plus récent d'abord. */
    const rank = { en_cours: 0, a_faire: 1, faite: 2 }
    return [...list].sort((a, b) => {
      if (rank[a.bucket] !== rank[b.bucket]) return rank[a.bucket] - rank[b.bucket]
      if (a.bucket === 'faite') {
        return new Date(b.installationDate || 0) - new Date(a.installationDate || 0)
      }
      return new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0)
    })
  }, [rows, filter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (denied) {
    return (
      <div className="ctrl-empty">
        <HeartPulse size={40} color="var(--gray-300)" />
        <p>Vous n'avez pas accès au parc des DAE.</p>
      </div>
    )
  }

  return (
    <div className={embedded ? 'mt-tab-panel' : 'page-content'}>
      <div className="page-header">
        <div>
          {!embedded && <h1 className="page-title"><HeartPulse size={20} /> Installations</h1>}
          <p className="page-subtitle">
            {stats.total} pose{stats.total !== 1 ? 's' : ''} au parc
            {stats.a_faire + stats.en_cours > 0 &&
              ` · ${stats.a_faire + stats.en_cours} en attente de mise en service`}
          </p>
        </div>
      </div>

      <div className="inst-stats">
        <div className="inst-stat-card">
          <div className="inst-stat-num">{stats.total}</div>
          <div className="inst-stat-label">Total</div>
        </div>
        <div className="inst-stat-card inst-stat-card--blue">
          <div className="inst-stat-num">{stats.a_faire}</div>
          <div className="inst-stat-label">À faire</div>
        </div>
        <div className="inst-stat-card inst-stat-card--amber">
          <div className="inst-stat-num">{stats.en_cours}</div>
          <div className="inst-stat-label">En cours</div>
        </div>
        <div className="inst-stat-card inst-stat-card--green">
          <div className="inst-stat-num">{stats.faite}</div>
          <div className="inst-stat-label">Faites</div>
        </div>
      </div>

      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Client, site, appareil, n° de série, technicien…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>
        <div className="inst-status-filters">
          {FILTERS.map(f => (
            <button
              key={f.value}
              className={`inst-filter-btn${filter === f.value ? ' inst-filter-btn--active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {f.value && <span className="inst-filter-count">{stats[f.value] ?? 0}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client / Site</th>
                <th>DAE</th>
                <th>Technicien</th>
                <th>Prévue</th>
                <th>Posée</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(inst => {
                const late = inst.bucket === 'en_cours' && inst.scheduledDate &&
                  new Date(inst.scheduledDate) < new Date(new Date().setHours(0, 0, 0, 0))
                return (
                  <tr key={inst._id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/devices/${inst._id}`)}>
                    <td>
                      <div className="inst-site-cell">
                        <div className="inst-site-client">{inst.clientName || '—'}</div>
                        {(inst.address || inst.location) && (
                          <div className="inst-site-loc">
                            <MapPin size={11} strokeWidth={1.8} />
                            {inst.address}{inst.location ? ` · ${inst.location}` : ''}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="inst-device-cell">
                        {inst.deviceType   && <span className="inst-device-type">{inst.deviceType}</span>}
                        {inst.serialNumber && <span className="inst-device-sn">{inst.serialNumber}</span>}
                        {!inst.deviceType && !inst.serialNumber && <span className="text-muted">—</span>}
                      </div>
                    </td>
                    <td>
                      <div className="iv-tech-cell">
                        <User size={12} strokeWidth={1.8} />
                        {inst.technicianName || inst.technician?.fullName
                          || <em className="text-muted">Non assigné</em>}
                      </div>
                    </td>
                    <td>
                      {inst.scheduledDate ? (
                        <div className={`iv-date-cell${late ? ' iv-card-date--late' : ''}`}>
                          <Calendar size={12} strokeWidth={1.8} />
                          {fmt(inst.scheduledDate)}
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {inst.installationDate ? (
                        <div className="iv-date-cell">
                          <CheckCircle2 size={12} strokeWidth={1.8} />
                          {fmt(inst.installationDate)}
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td><BucketBadge bucket={inst.bucket} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      {inst.bucket !== 'faite' && canReport && (
                        <button className="btn btn--primary btn--sm" onClick={() => setPosing(inst)}>
                          <CheckCircle2 size={13} /> Compte rendu
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="table-empty">
                  {search || filter
                    ? 'Aucune installation pour ces critères.'
                    : 'Aucune installation enregistrée.'}
                </td></tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={15} />
              </button>
              <span className="pag-info">
                Page {page} / {totalPages} · {filtered.length} installation{filtered.length !== 1 ? 's' : ''}
              </span>
              <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      {posing && (
        <InstallationCompleteModal
          installation={posing}
          onClose={() => setPosing(null)}
          onDone={() => { setPosing(null); load() }}
        />
      )}
    </div>
  )
}
