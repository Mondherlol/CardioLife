import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, Pencil, Trash2, Eye, X, AlertTriangle,
  Zap, MapPin,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import { getInstallations, deleteInstallation } from '../api/installations'

/* ─── Helpers ───────────────────────────────────────────────── */

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function daysUntil(d) {
  if (!d) return null
  return Math.round((new Date(d) - new Date()) / 86400000)
}

function computeStatus(inst) {
  const now  = new Date()
  const d60  = new Date(now.getTime() + 60 * 86400000)
  const ctrl = inst.nextControlDate ? new Date(inst.nextControlDate) : null

  const firstBatt = inst.batteries?.[0]
  const batt      = firstBatt?.expiryDate ? new Date(firstBatt.expiryDate) : null
  const level     = firstBatt?.level

  const firstElec = inst.electrodes?.[0]
  const elec      = firstElec?.expiryDate ? new Date(firstElec.expiryDate) : null

  if ((ctrl && ctrl < now) || (batt && batt < now) || (elec && elec < now)) return 'expiré'
  if ((level != null && level < 25) || (ctrl && ctrl <= d60)) return 'attention'
  return 'actif'
}

function StatusBadge({ inst }) {
  const s = computeStatus(inst)
  const cls = s === 'expiré'    ? 'inst-badge inst-badge--expired'
            : s === 'attention' ? 'inst-badge inst-badge--warning'
            : 'inst-badge inst-badge--ok'
  const label = s === 'expiré' ? 'Expiré' : s === 'attention' ? 'Attention' : 'Actif'
  return <span className={cls}>{label}</span>
}

function BatteryBar({ level }) {
  if (level == null) return <span className="text-muted">—</span>
  const cls = level < 25 ? 'batt-bar--red' : level < 50 ? 'batt-bar--amber' : 'batt-bar--green'
  return (
    <div className="batt-bar-wrap">
      <div className="batt-bar">
        <div className={`batt-bar-fill ${cls}`} style={{ width: `${level}%` }} />
      </div>
      <span className={`batt-pct batt-pct--${level < 25 ? 'red' : level < 50 ? 'amber' : 'green'}`}>
        {level}%
      </span>
    </div>
  )
}

function ControlDate({ date }) {
  if (!date) return <span className="text-muted">—</span>
  const days = daysUntil(date)
  const cls  = days < 0    ? 'ctrl-date ctrl-date--expired'
             : days <= 60  ? 'ctrl-date ctrl-date--soon'
             : 'ctrl-date ctrl-date--ok'
  return (
    <div className={cls}>
      <span>{formatDate(date)}</span>
      {days != null && (
        <span className="ctrl-date-sub">
          {days < 0 ? `${Math.abs(days)}j dépassé` : days === 0 ? "Aujourd'hui" : `dans ${days}j`}
        </span>
      )}
    </div>
  )
}

/* ─── Delete Confirm ────────────────────────────────────────── */

function DeleteModal({ inst, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false)
  async function handleConfirm() {
    setLoading(true)
    try { await onConfirm() } catch (err) { toast.error(err.message); setLoading(false) }
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Supprimer l'installation</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="destroy-warning">
            <AlertTriangle size={18} />
            <p>Cette action est <strong>irréversible</strong>.</p>
          </div>
          <p className="delete-confirm-text" style={{ marginTop: 12 }}>
            Supprimer l'installation <strong>{inst.clientName}</strong> — {inst.address}
            {inst.location ? ` (${inst.location})` : ''} ?
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--danger" onClick={handleConfirm} disabled={loading}>
            {loading && <span className="spinner spinner--sm" />}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main Page ─────────────────────────────────────────────── */

const STATUS_FILTERS = [
  { value: '',          label: 'Tous' },
  { value: 'actif',     label: 'Actif' },
  { value: 'attention', label: 'Attention' },
  { value: 'expiré',    label: 'Expiré' },
]

export default function DevicesPage() {
  const navigate = useNavigate()
  const { user }  = useAuth()

  const [all, setAll]             = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('')
  const [deleteTarget, setDelete] = useState(null)

  const canManage = user?.role === 'superadmin' || user?.role === 'admin'
    || user?.permissions?.canManageDevices

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getInstallations({ limit: 500 })
      setAll(res.data)
    } catch (err) {
      toast.error(err.message || 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  /* ── Client-side filter ── */
  const filtered = useMemo(() => {
    let list = all
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.clientName?.toLowerCase().includes(q) ||
        i.address?.toLowerCase().includes(q) ||
        i.location?.toLowerCase().includes(q) ||
        i.serialNumber?.toLowerCase().includes(q) ||
        i.deviceType?.toLowerCase().includes(q)
      )
    }
    if (statusFilter) {
      list = list.filter(i => computeStatus(i) === statusFilter)
    }
    return list
  }, [all, search, statusFilter])

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:   all.length,
    expired: all.filter(i => computeStatus(i) === 'expiré').length,
    warning: all.filter(i => computeStatus(i) === 'attention').length,
    lowBatt: all.filter(i => (i.batteries?.[0]?.level ?? null) !== null && i.batteries[0].level < 25).length,
  }), [all])

  async function handleDelete() {
    await deleteInstallation(deleteTarget._id)
    setAll(prev => prev.filter(i => i._id !== deleteTarget._id))
    toast.success('Installation supprimée.')
    setDelete(null)
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title"><Zap size={20} strokeWidth={1.8} /> DAE Installés</h1>
          <p className="page-subtitle">{all.length} installation{all.length !== 1 ? 's' : ''}</p>
        </div>
        {canManage && (
          <button className="btn btn--primary" onClick={() => navigate('/devices/new')}>
            <Plus size={15} /> Nouvelle installation
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="inst-stats">
        <div className="inst-stat-card">
          <div className="inst-stat-num">{stats.total}</div>
          <div className="inst-stat-label">Installations</div>
        </div>
        <div className="inst-stat-card inst-stat-card--red">
          <div className="inst-stat-num">{stats.expired}</div>
          <div className="inst-stat-label">Expirées</div>
        </div>
        <div className="inst-stat-card inst-stat-card--amber">
          <div className="inst-stat-num">{stats.warning}</div>
          <div className="inst-stat-label">Attention (60j)</div>
        </div>
        <div className="inst-stat-card inst-stat-card--orange">
          <div className="inst-stat-num">{stats.lowBatt}</div>
          <div className="inst-stat-label">Batterie &lt;25%</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Client, adresse, n° de série…"
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
                  {f.value === 'expiré'    ? stats.expired
                   : f.value === 'attention' ? stats.warning
                   : stats.total - stats.expired - stats.warning}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client / Site</th>
                <th>Appareil</th>
                <th>Batterie</th>
                <th>Électrode</th>
                <th>Prochain contrôle</th>
                <th>Statut</th>
                <th style={{ width: 110 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inst => (
                <tr
                  key={inst._id}
                  className="table-row-clickable"
                  onClick={() => navigate(`/devices/${inst._id}`)}
                >
                  <td>
                    <div className="inst-site-cell">
                      <button
                        type="button"
                        className="inst-site-client cell-link"
                        style={{ textAlign: 'left', padding: 0, width: 'fit-content' }}
                        onClick={e => {
                          e.stopPropagation()
                          if (inst.client?._id) navigate(`/clients/${inst.client._id}`)
                        }}
                      >
                        {inst.client?.name || inst.clientName}
                      </button>
                      <div className="inst-site-loc">
                        <MapPin size={11} strokeWidth={1.8} />
                        {inst.address}{inst.location ? ` · ${inst.location}` : ''}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="inst-device-cell">
                      {inst.deviceType   && <span className="inst-device-type">{inst.deviceType}</span>}
                      {inst.serialNumber && <span className="inst-device-sn">{inst.serialNumber}</span>}
                      {!inst.deviceType && !inst.serialNumber && <span className="text-muted">—</span>}
                    </div>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <BatteryBar level={inst.batteries?.[0]?.level} />
                  </td>
                  <td>
                    <ControlDate date={inst.electrodes?.[0]?.expiryDate} />
                  </td>
                  <td>
                    <ControlDate date={inst.nextControlDate} />
                  </td>
                  <td>
                    <StatusBadge inst={inst} />
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="sp-actions">
                      <button className="sp-action-btn" title="Voir le détail"
                        onClick={() => navigate(`/devices/${inst._id}`)}>
                        <Eye size={14} />
                      </button>
                      {canManage && (
                        <>
                          <button className="sp-action-btn" title="Modifier"
                            onClick={() => navigate(`/devices/${inst._id}/edit`)}>
                            <Pencil size={14} />
                          </button>
                          <button className="sp-action-btn sp-action-btn--danger" title="Supprimer"
                            onClick={() => setDelete(inst)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={7} className="table-empty">
                  {search || statusFilter ? 'Aucun résultat pour ces critères.' : 'Aucune installation enregistrée.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <DeleteModal inst={deleteTarget}
          onClose={() => setDelete(null)} onConfirm={handleDelete} />
      )}
    </div>
  )
}
