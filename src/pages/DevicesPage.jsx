import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, Pencil, Trash2, X, AlertTriangle,
  Zap, Check, ChevronDown, ArrowUp, ArrowDown,
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
  if (inst.status === 'a_installer') {
    return <span className="inst-badge inst-badge--pending">À installer</span>
  }
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

function DeviceStatusSelector({ selected, stats, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const options = STATUS_FILTERS.filter(s => s.value)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function toggle(value) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  const counts = { actif: stats.active, attention: stats.warning, 'expirÃ©': stats.expired }
  const label = selected.length === 0
    ? 'Tous les statuts'
    : selected.length === 1
      ? options.find(s => s.value === selected[0])?.label
      : `${selected.length} statuts`

  return (
    <div className="inst-status-select" ref={wrapRef}>
      <button
        type="button"
        className={`inst-status-select-btn${open ? ' inst-status-select-btn--open' : ''}${selected.length ? ' inst-status-select-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="inst-status-select-label">{label}</span>
        {selected.length > 0 && <span className="inst-status-select-count">{selected.length}</span>}
        <ChevronDown size={14} className="inst-status-select-chevron" />
      </button>
      {open && (
        <div className="inst-status-select-menu">
          <button
            type="button"
            className={`inst-status-select-option${selected.length === 0 ? ' inst-status-select-option--active' : ''}`}
            onClick={() => onChange([])}
          >
            <span className="inst-status-select-check">{selected.length === 0 && <Check size={12} />}</span>
            <span>Tous les statuts</span>
            <span className="inst-status-select-option-count">{stats.total}</span>
          </button>
          {options.map(s => {
            const active = selected.includes(s.value)
            return (
              <button
                key={s.value}
                type="button"
                className={`inst-status-select-option${active ? ' inst-status-select-option--active' : ''}`}
                onClick={() => toggle(s.value)}
              >
                <span className="inst-status-select-check">{active && <Check size={12} />}</span>
                <span>{s.label}</span>
                <span className="inst-status-select-option-count">{counts[s.value] || 0}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function DevicesPage() {
  const navigate = useNavigate()
  const { user }  = useAuth()

  const [all, setAll]             = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState([])
  const [sortField, setSortField] = useState('client')
  const [sortDir, setSortDir]     = useState('asc')
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
    if (statusFilter.length) {
      list = list.filter(i => statusFilter.includes(computeStatus(i)))
    }
    const statusOrder = { actif: 1, attention: 2, 'expirÃ©': 3 }
    const valueForSort = (inst) => {
      if (sortField === 'client') return inst.client?.name || inst.clientName || ''
      if (sortField === 'device') return inst.deviceProduct?.name || inst.deviceType || ''
      if (sortField === 'battery') return inst.batteries?.[0]?.level ?? -1
      if (sortField === 'electrode') return inst.electrodes?.[0]?.expiryDate ? new Date(inst.electrodes[0].expiryDate).getTime() : 0
      if (sortField === 'control') return inst.nextControlDate ? new Date(inst.nextControlDate).getTime() : 0
      if (sortField === 'status') return statusOrder[computeStatus(inst)] || 0
      return ''
    }
    return [...list].sort((a, b) => {
      const av = valueForSort(a)
      const bv = valueForSort(b)
      const res = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'fr', { sensitivity: 'base' })
      return sortDir === 'asc' ? res : -res
    })
  }, [all, search, statusFilter, sortField, sortDir])

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:   all.length,
    active:  all.filter(i => computeStatus(i) === 'actif').length,
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

  function toggleSort(field) {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function sortIcon(field) {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ArrowUp size={12} strokeWidth={2.2} className="th-sort-icon" />
      : <ArrowDown size={12} strokeWidth={2.2} className="th-sort-icon" />
  }

  function siteLabel(inst) {
    return inst.location || inst.client?.address?.city || inst.address || ''
  }

  return (
    <div className="page-content devices-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title"><Zap size={20} strokeWidth={1.8} /> DAE Installés</h1>
          <p className="page-subtitle">{all.length} installation{all.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="devices-header-actions">
          {canManage && (
            <button className="btn btn--primary" onClick={() => navigate('/devices/new')}>
              <Plus size={15} /> Nouvelle installation
            </button>
          )}
        </div>
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
      <div className="table-toolbar devices-toolbar">
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
        <DeviceStatusSelector selected={statusFilter} stats={stats} onChange={setStatus} />
        <div className="inst-status-filters" style={{ display: 'none' }}>
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
        <div className="table-wrap devices-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><button className="th-sort-btn" onClick={() => toggleSort('client')}>Client / Site {sortIcon('client')}</button></th>
                <th><button className="th-sort-btn" onClick={() => toggleSort('device')}>Appareil {sortIcon('device')}</button></th>
                <th><button className="th-sort-btn" onClick={() => toggleSort('battery')}>Batterie {sortIcon('battery')}</button></th>
                <th><button className="th-sort-btn" onClick={() => toggleSort('electrode')}>Électrode {sortIcon('electrode')}</button></th>
                <th><button className="th-sort-btn" onClick={() => toggleSort('control')}>Prochain contrôle {sortIcon('control')}</button></th>
                <th><button className="th-sort-btn" onClick={() => toggleSort('status')}>Statut {sortIcon('status')}</button></th>
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
                        {inst.address}{inst.location ? ` · ${inst.location}` : ''}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="inst-device-cell">
                      {(inst.deviceProduct?.name || inst.deviceType) && <span className="inst-device-type">{inst.deviceProduct?.name || inst.deviceType}</span>}
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
                      <button className="sp-action-btn inst-detail-action-hidden" title="Voir le détail"
                        onClick={() => navigate(`/devices/${inst._id}`)}>
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
