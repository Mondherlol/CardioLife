import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wrench, Plus, Search, X, CheckCircle2,
  Clock, AlertCircle, Calendar, MapPin, Zap, User,
  ChevronDown, AlertTriangle, ArrowRight,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import { getInterventions, createIntervention } from '../api/interventions'
import { get } from '../api/http'

/* ─── Constants ─────────────────────────────────────────────── */

const STATUS_META = {
  planifie:  { label: 'Planifié',   cls: 'iv-badge iv-badge--blue',   Icon: Clock        },
  en_cours:  { label: 'En cours',   cls: 'iv-badge iv-badge--orange', Icon: AlertCircle  },
  termine:   { label: 'Terminé',    cls: 'iv-badge iv-badge--green',  Icon: CheckCircle2 },
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

function CreateModal({ onClose, onCreated }) {
  const [techniciens,   setTechniciens]   = useState([])
  const [installations, setInstallations] = useState([])
  const [recentInst,    setRecentInst]    = useState([])
  const [clientSearch,  setClientSearch]  = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [loadingInst,   setLoadingInst]   = useState(false)
  const [saving,        setSaving]        = useState(false)

  const [form, setForm] = useState({
    clientName:    '',
    installation:  '',
    technicien:    '',
    technicienName:'',
    scheduledDate: '',
    notes:         '',
  })

  useEffect(() => {
    get('/users?role=technicien&limit=100')
      .then(res => setTechniciens(res.data || res))
      .catch(() => {})
    get('/interventions/search-installations?limit=8')
      .then(data => setRecentInst(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!clientSearch.trim()) { setInstallations([]); return }
    const t = setTimeout(async () => {
      setLoadingInst(true)
      try {
        const qs = new URLSearchParams({ search: clientSearch, limit: 20 }).toString()
        const data = await get(`/interventions/search-installations?${qs}`)
        setInstallations(Array.isArray(data) ? data : [])
      } catch { /* ignore */ }
      finally { setLoadingInst(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [clientSearch])

  const displayedInst = clientSearch.trim() ? installations : recentInst

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })) }

  function selectInstallation(inst) {
    setForm(p => ({
      ...p,
      installation:  inst._id,
      clientName:    inst.client?.name || inst.clientName || '',
      installationSnap: {
        deviceType:   inst.deviceType   || '',
        serialNumber: inst.serialNumber || '',
        address:      inst.address      || '',
        location:     inst.location     || '',
      },
    }))
    setClientSearch(inst.client?.name || inst.clientName || '')
    setInstallations([])
    setSearchFocused(false)
  }

  function selectTechnicien(e) {
    const t = techniciens.find(u => u._id === e.target.value)
    setForm(p => ({
      ...p,
      technicien:     t?._id || '',
      technicienName: t?.fullName || t?.username || '',
    }))
  }

  async function handleCreate() {
    if (!form.installation) return toast.error('Sélectionnez un DAE.')
    if (!form.scheduledDate) return toast.error('La date planifiée est requise.')
    setSaving(true)
    try {
      const created = await createIntervention(form)
      toast.success('Intervention créée.')
      onCreated(created)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const selectedSnap = form.installationSnap

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md modal--dropdown">
        <div className="modal-header">
          <h2 className="modal-title">
            <Plus size={16} /> Nouvelle intervention
          </h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label className="form-label">Client / DAE *</label>
            <div className="iv-search-wrap">
              <Search size={13} className="iv-search-icon" />
              <input
                className="form-input"
                placeholder="Rechercher par client, adresse, n° de série…"
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setForm(p => ({ ...p, installation: '' })) }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                style={{ paddingLeft: 30 }}
              />
              {loadingInst && <span className="spinner spinner--sm" style={{ position: 'absolute', right: 10 }} />}

              {searchFocused && displayedInst.length > 0 && (
                <div className="iv-dropdown">
                  {!clientSearch.trim() && (
                    <div className="iv-dropdown-label">Récents</div>
                  )}
                  {displayedInst.map(inst => (
                    <button
                      key={inst._id}
                      type="button"
                      className="iv-dropdown-item"
                      onClick={() => selectInstallation(inst)}
                    >
                      <Zap size={12} strokeWidth={2} />
                      <div>
                        <div className="iv-dd-client">{inst.client?.name || inst.clientName}</div>
                        <div className="iv-dd-info">
                          {inst.deviceType} · {inst.serialNumber} · {inst.address}
                          {inst.location ? ` (${inst.location})` : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedSnap && form.installation && (
              <div className="iv-selected-snap">
                <Zap size={12} strokeWidth={2} />
                <span>
                  <strong>{selectedSnap.deviceType}</strong> · {selectedSnap.serialNumber}
                  {selectedSnap.location ? ` · ${selectedSnap.location}` : ''}
                </span>
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Technicien assigné</label>
            <div className="fiche-select-wrap">
              <select
                className="form-input"
                value={form.technicien}
                onChange={selectTechnicien}
              >
                <option value="">— Non assigné —</option>
                {techniciens.map(t => (
                  <option key={t._id} value={t._id}>{t.fullName || t.username}</option>
                ))}
              </select>
              <ChevronDown size={13} className="fiche-select-chevron" />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Date planifiée *</label>
            <input
              type="date"
              className="form-input"
              value={form.scheduledDate}
              onChange={e => setF('scheduledDate', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Instructions pour le technicien…"
              value={form.notes}
              onChange={e => setF('notes', e.target.value)}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={handleCreate} disabled={saving}>
            {saving && <span className="spinner spinner--sm" />}
            <Plus size={14} /> Créer
          </button>
        </div>
      </div>
    </div>
  )
}

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
    plus_tard: { key: 'plus_tard', label: 'Plus tard',            accent: 'gray',   items: [] },
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

export default function InterventionsPage() {
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

  useEffect(() => { fetchAll() }, [fetchAll])

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
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Wrench size={20} strokeWidth={1.8} /> Interventions
          </h1>
          {isTech ? (
            <p className="page-subtitle">
              Bonjour <strong>{user.fullName || user.username}</strong> —
              {pendingCount > 0
                ? <> <span className="iv-pending-count">{pendingCount}</span> intervention{pendingCount > 1 ? 's' : ''} en attente</>
                : <> Toutes vos interventions sont à jour</>
              }
            </p>
          ) : (
            <p className="page-subtitle">{all.length} intervention{all.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        {canManage && (
          <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Nouvelle intervention
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
          <div className="table-empty" style={{ padding: '48px 0', textAlign: 'center' }}>
            {search || statusFilter
              ? 'Aucune intervention pour ces critères.'
              : 'Aucune intervention ne vous est assignée.'}
          </div>
        ) : groupedSections.length === 0 ? (
          <div className="table-empty" style={{ padding: '48px 0', textAlign: 'center' }}>
            Aucune intervention pour ces critères.
          </div>
        ) : (
          <div className="iv-dashboard">
            {groupedSections.map(g => (
              <DateSection
                key={g.key}
                group={g}
                onCardClick={id => navigate(`/interventions/${id}`)}
                defaultOpen={g.key !== 'termine' && g.key !== 'plus_tard'}
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
                <th>Planifié</th>
                <th>Réalisé</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(iv => (
                <AdminRow
                  key={iv._id}
                  intervention={iv}
                  onClick={() => navigate(`/interventions/${iv._id}`)}
                />
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="table-empty">
                  {search || statusFilter
                    ? 'Aucun résultat pour ces critères.'
                    : 'Aucune intervention enregistrée.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}
    </div>
  )
}
