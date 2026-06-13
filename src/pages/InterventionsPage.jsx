import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Wrench, Plus, Search, X, Eye, Trash2, CheckCircle2,
  Clock, AlertCircle, Calendar, MapPin, Zap, User,
  ChevronDown, ClipboardList, History,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import {
  getInterventions, createIntervention,
  updateIntervention, submitRapport, deleteIntervention,
} from '../api/interventions'
import { get } from '../api/http'

/* ─── Constants ─────────────────────────────────────────────── */

const ETAT_OPTS_STANDARD = [
  { value: '',            label: '—' },
  { value: 'conforme',    label: 'Conforme' },
  { value: 'non_conforme',label: 'Non conforme' },
  { value: 'remplace',    label: 'Remplacé' },
]
const ETAT_OPTS_BATTERIE = [
  { value: '',            label: '—' },
  { value: 'conforme',    label: 'Conforme' },
  { value: 'non_conforme',label: 'Non conforme' },
  { value: 'remplacee',   label: 'Remplacée' },
]
const ETAT_OPTS_ELECTRODES = [
  { value: '',             label: '—' },
  { value: 'conformes',    label: 'Conformes' },
  { value: 'non_conformes',label: 'Non conformes' },
  { value: 'remplacees',   label: 'Remplacées' },
]

const CHAMPS_RAPPORT = [
  { key: 'dae',          label: 'DAE / Appareil',   opts: ETAT_OPTS_STANDARD },
  { key: 'armoire',      label: 'Armoire',           opts: ETAT_OPTS_STANDARD },
  { key: 'signaletique', label: 'Signalétique',      opts: ETAT_OPTS_STANDARD },
  { key: 'batterie',     label: 'Batterie',          opts: ETAT_OPTS_BATTERIE },
  { key: 'electrodes',   label: 'Électrodes',        opts: ETAT_OPTS_ELECTRODES },
]

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

function etatLabel(value) {
  const all = [...ETAT_OPTS_STANDARD, ...ETAT_OPTS_BATTERIE, ...ETAT_OPTS_ELECTRODES]
  return all.find(o => o.value === value)?.label || '—'
}

function etatCls(value) {
  if (!value) return 'etat-badge etat-badge--empty'
  if (value.includes('non_')) return 'etat-badge etat-badge--bad'
  if (value.includes('remplac')) return 'etat-badge etat-badge--replaced'
  return 'etat-badge etat-badge--ok'
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

/* ─── Fiche Modal (remplir / consulter) ─────────────────────── */

function FicheModal({ intervention, readOnly, onClose, onSubmit }) {
  const snap = intervention.installationSnap || {}
  const [rapport, setRapport] = useState({
    dae:          intervention.rapport?.dae          || '',
    armoire:      intervention.rapport?.armoire      || '',
    signaletique: intervention.rapport?.signaletique || '',
    batterie:     intervention.rapport?.batterie     || '',
    electrodes:   intervention.rapport?.electrodes   || '',
    observations: intervention.rapport?.observations || '',
    dateVisite:   intervention.rapport?.dateVisite
      ? new Date(intervention.rapport.dateVisite).toISOString().slice(0,10)
      : new Date().toISOString().slice(0,10),
  })
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('fiche')

  function set(k, v) { setRapport(p => ({ ...p, [k]: v })) }

  async function handleSubmit() {
    setSaving(true)
    try {
      await onSubmit(intervention._id, rapport)
      toast.success('Fiche soumise avec succès.')
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--lg">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">
              <ClipboardList size={16} strokeWidth={2} />
              Fiche d&apos;Intervention
            </h2>
            <p className="modal-subtitle">{intervention.clientName}</p>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* DAE info banner */}
        <div className="fiche-dae-banner">
          <div className="fiche-dae-row">
            <span className="fiche-dae-item">
              <Zap size={13} strokeWidth={2} />
              <strong>{snap.deviceType || '—'}</strong>
            </span>
            <span className="fiche-dae-sep">·</span>
            <span className="fiche-dae-item">
              N° série : <strong>{snap.serialNumber || '—'}</strong>
            </span>
          </div>
          <div className="fiche-dae-row">
            <span className="fiche-dae-item">
              <MapPin size={12} strokeWidth={2} />
              {snap.address}{snap.location ? ` — ${snap.location}` : ''}
            </span>
          </div>
        </div>

        {/* Tabs (show history only in read-only/admin mode) */}
        {readOnly && intervention.history?.length > 0 && (
          <div className="fiche-tabs">
            <button className={`fiche-tab${tab === 'fiche' ? ' fiche-tab--active' : ''}`}
              onClick={() => setTab('fiche')}>
              <ClipboardList size={13} /> Fiche
            </button>
            <button className={`fiche-tab${tab === 'history' ? ' fiche-tab--active' : ''}`}
              onClick={() => setTab('history')}>
              <History size={13} /> Historique
            </button>
          </div>
        )}

        <div className="modal-body">
          {tab === 'history' ? (
            <div className="iv-history">
              {intervention.history.map((h, i) => (
                <div key={i} className="iv-history-item">
                  <div className="iv-history-dot" />
                  <div>
                    <div className="iv-history-action">{h.details || h.action}</div>
                    <div className="iv-history-meta">
                      {h.userName} · {fmt(h.date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* État des équipements */}
              <div className="fiche-section">
                <h3 className="fiche-section-title">État des équipements</h3>
                <div className="fiche-grid">
                  {CHAMPS_RAPPORT.map(({ key, label, opts }) => (
                    <div key={key} className="fiche-field">
                      <label className="fiche-label">{label}</label>
                      {readOnly ? (
                        <span className={etatCls(rapport[key])}>
                          {etatLabel(rapport[key])}
                        </span>
                      ) : (
                        <div className="fiche-select-wrap">
                          <select
                            className="fiche-select"
                            value={rapport[key]}
                            onChange={e => set(key, e.target.value)}
                          >
                            {opts.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <ChevronDown size={13} className="fiche-select-chevron" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Date de visite */}
              <div className="fiche-section">
                <h3 className="fiche-section-title">Informations</h3>
                <div className="fiche-field" style={{ maxWidth: 240 }}>
                  <label className="fiche-label">Date de visite</label>
                  {readOnly ? (
                    <span className="fiche-value">{fmt(rapport.dateVisite)}</span>
                  ) : (
                    <input
                      type="date"
                      className="fiche-input"
                      value={rapport.dateVisite}
                      onChange={e => set('dateVisite', e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* Observations */}
              <div className="fiche-section">
                <h3 className="fiche-section-title">Observations</h3>
                {readOnly ? (
                  <p className="fiche-observations">
                    {rapport.observations || <em className="text-muted">Aucune observation.</em>}
                  </p>
                ) : (
                  <textarea
                    className="fiche-textarea"
                    rows={4}
                    placeholder="Remarques, anomalies constatées, pièces remplacées…"
                    value={rapport.observations}
                    onChange={e => set('observations', e.target.value)}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>
            {readOnly ? 'Fermer' : 'Annuler'}
          </button>
          {!readOnly && (
            <button className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
              {saving && <span className="spinner spinner--sm" />}
              <CheckCircle2 size={14} /> Soumettre la fiche
            </button>
          )}
        </div>
      </div>
    </div>
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

  // Load technicians + recent installations on mount
  useEffect(() => {
    get('/users?role=technicien&limit=100')
      .then(res => setTechniciens(res.data || res))
      .catch(() => {})
    get('/interventions/search-installations?limit=8')
      .then(data => setRecentInst(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Search installations when clientSearch changes
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

  // Displayed list: search results when typing, recent when empty
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
          {/* DAE search */}
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

          {/* Technicien */}
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

          {/* Date */}
          <div className="form-field">
            <label className="form-label">Date planifiée *</label>
            <input
              type="date"
              className="form-input"
              value={form.scheduledDate}
              onChange={e => setF('scheduledDate', e.target.value)}
            />
          </div>

          {/* Notes */}
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

/* ─── Delete Confirm ─────────────────────────────────────────── */

function DeleteModal({ intervention, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false)
  async function handle() {
    setLoading(true)
    try { await onConfirm() } catch (err) { toast.error(err.message); setLoading(false) }
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Supprimer l&apos;intervention</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p>Supprimer l&apos;intervention pour <strong>{intervention.clientName}</strong> du {fmt(intervention.scheduledDate)} ?</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--danger" onClick={handle} disabled={loading}>
            {loading && <span className="spinner spinner--sm" />} Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Technician Card ────────────────────────────────────────── */

function TechnicianCard({ intervention, onFill, onView }) {
  const snap = intervention.installationSnap || {}
  const isDone = intervention.status === 'termine'
  return (
    <div className={`iv-card${isDone ? ' iv-card--done' : ''}`}>
      <div className="iv-card-header">
        <div className="iv-card-client">{intervention.clientName || '—'}</div>
        <StatusBadge status={intervention.status} />
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
          <span>Planifié le {fmt(intervention.scheduledDate)}</span>
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

      <div className="iv-card-footer">
        {isDone ? (
          <button className="btn btn--ghost btn--sm" onClick={() => onView(intervention)}>
            <Eye size={13} /> Voir la fiche
          </button>
        ) : (
          <button className="btn btn--primary btn--sm" onClick={() => onFill(intervention)}>
            <ClipboardList size={13} /> Remplir la fiche
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── Admin Table Row ────────────────────────────────────────── */

function AdminRow({ intervention, onView, onDelete, canManage }) {
  const snap = intervention.installationSnap || {}
  return (
    <tr>
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
      <td>
        <div className="sp-actions">
          <button className="sp-action-btn" title="Voir la fiche" onClick={() => onView(intervention)}>
            <Eye size={14} />
          </button>
          {canManage && (
            <button className="sp-action-btn sp-action-btn--danger" title="Supprimer" onClick={() => onDelete(intervention)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </td>
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
  const isTech   = user?.role === 'technicien'
  const canManage = user?.role === 'superadmin' || user?.role === 'admin'
    || user?.permissions?.canManageInterventions

  const [all, setAll]             = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('')

  const [showCreate, setShowCreate]     = useState(false)
  const [ficheTarget, setFicheTarget]   = useState(null)
  const [ficheReadOnly, setReadOnly]    = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

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

  /* ── Filters ── */
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

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:    all.length,
    planifie: all.filter(i => i.status === 'planifie').length,
    en_cours: all.filter(i => i.status === 'en_cours').length,
    termine:  all.filter(i => i.status === 'termine').length,
  }), [all])

  function openFill(iv)  { setFicheTarget(iv); setReadOnly(false) }
  function openView(iv)  { setFicheTarget(iv); setReadOnly(true)  }

  async function handleSubmitRapport(id, rapport) {
    const updated = await submitRapport(id, { rapport })
    setAll(prev => prev.map(i => i._id === id ? updated : i))
  }

  async function handleDelete() {
    await deleteIntervention(deleteTarget._id)
    setAll(prev => prev.filter(i => i._id !== deleteTarget._id))
    toast.success('Intervention supprimée.')
    setDeleteTarget(null)
  }

  function onCreated(created) {
    setAll(prev => [created, ...prev])
  }

  /* ── Technician greeting ── */
  const pendingCount = isTech
    ? all.filter(i => i.status !== 'termine').length
    : null

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
        /* ── Technician: card grid ── */
        filtered.length === 0 ? (
          <div className="table-empty" style={{ padding: '48px 0', textAlign: 'center' }}>
            {search || statusFilter
              ? 'Aucune intervention pour ces critères.'
              : 'Aucune intervention ne vous est assignée.'}
          </div>
        ) : (
          <div className="iv-cards-grid">
            {filtered.map(iv => (
              <TechnicianCard
                key={iv._id}
                intervention={iv}
                onFill={openFill}
                onView={openView}
              />
            ))}
          </div>
        )
      ) : (
        /* ── Admin: table ── */
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
                <th style={{ width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(iv => (
                <AdminRow
                  key={iv._id}
                  intervention={iv}
                  onView={openView}
                  onDelete={setDeleteTarget}
                  canManage={canManage}
                />
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="table-empty">
                  {search || statusFilter
                    ? 'Aucun résultat pour ces critères.'
                    : 'Aucune intervention enregistrée.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}

      {ficheTarget && (
        <FicheModal
          intervention={ficheTarget}
          readOnly={ficheReadOnly}
          onClose={() => setFicheTarget(null)}
          onSubmit={handleSubmitRapport}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          intervention={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
