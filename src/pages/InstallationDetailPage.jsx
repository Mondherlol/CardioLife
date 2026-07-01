import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Pencil, Trash2, Zap, MapPin, Calendar,
  Activity, AlertTriangle, X, Battery, Plus, CheckCircle2,
  ClipboardList, Clock, ChevronRight, Check, User, Wrench, FileText,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import { getInstallation, deleteInstallation } from '../api/installations'
import { getInterventions, createIntervention, deleteIntervention } from '../api/interventions'
import { getUsers } from '../api/users'

/* Type de contrôle → libellé */
const CONTROL_TYPE_LABELS = {
  semestriel:   'Semestriel',
  annuel:       'Annuel',
  hors_contrat: 'Hors contrat',
}
const INTERVENTION_STATUS = {
  planifie: { label: 'Planifié', cls: 'iv-badge iv-badge--blue' },
  en_cours: { label: 'En cours', cls: 'iv-badge iv-badge--orange' },
  termine:  { label: 'Terminé',  cls: 'iv-badge iv-badge--green' },
}

/* ─── Helpers ───────────────────────────────────────────────── */
function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function daysUntil(d) {
  if (!d) return null
  const target = new Date(d)
  const now = new Date()
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((t - n) / 86400000)
}

function todayStr() {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function todayPlusMonths(n) {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function toDateInput(d) {
  if (!d) return ''
  try { return new Date(d).toISOString().split('T')[0] } catch { return '' }
}

function computeStatus(inst) {
  if (!inst) return 'actif'
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

function RelativeDate({ date, label }) {
  if (!date) return (
    <div className="inst-metric-card">
      <div className="inst-metric-label">{label}</div>
      <div className="inst-metric-value inst-metric-value--muted">—</div>
    </div>
  )
  const days = daysUntil(date)
  const cls  = days < 0 ? 'inst-metric-value--red' : days <= 60 ? 'inst-metric-value--amber' : 'inst-metric-value--green'
  return (
    <div className="inst-metric-card">
      <div className="inst-metric-label">{label}</div>
      <div className={`inst-metric-value ${cls}`}>{formatDate(date)}</div>
      {days != null && (
        <div className="inst-metric-sub">
          {days < 0 ? `Dépassé de ${Math.abs(days)} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value }) {
  return (
    <div className="inst-detail-item">
      <dt className="inst-detail-label">{label}</dt>
      <dd className="inst-detail-value">{value || '—'}</dd>
    </div>
  )
}

function DetailLink({ label, value, onClick }) {
  return (
    <div className="inst-detail-item">
      <dt className="inst-detail-label">{label}</dt>
      <dd className="inst-detail-value">
        <button type="button" className="cell-link" onClick={onClick}>{value}</button>
      </dd>
    </div>
  )
}

/* ─── PLANIFIER UN CONTRÔLE (crée une intervention hors contrat) ── */
function ScheduleControlModal({ installation, users, onClose, onCreated }) {
  const [form, setForm] = useState({
    date:         toDateInput(installation.nextControlDate) || todayStr(),
    time:         '09:00',
    technicienId: '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const techniciens = users.filter(u => u.role === 'technicien')
  const pickable    = techniciens.length ? techniciens : users

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.date) return setError('La date est requise.')
    const start = new Date(`${form.date}T${form.time || '09:00'}`)
    if (isNaN(start.getTime())) return setError('Date ou heure invalide.')
    setLoading(true)
    try {
      const tech = pickable.find(u => u._id === form.technicienId)
      const created = await createIntervention({
        installation:  installation._id,
        client:        installation.client?._id || installation.client,
        clientName:    installation.clientName,
        installationSnap: {
          deviceType:   installation.deviceType   || '',
          serialNumber: installation.serialNumber || '',
          address:      installation.address      || '',
          location:     installation.location     || '',
        },
        technicien:     tech?._id || undefined,
        technicienName: tech ? (tech.fullName || tech.username) : undefined,
        scheduledDate:  start.toISOString(),
        controlType:    'hors_contrat',
      })
      toast.success('Contrôle planifié — visible dans le planning.')
      onCreated(created)
    } catch (err) {
      setError(err.message || 'Erreur.')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Planifier un contrôle</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="ctrl-hint-line">
            <AlertTriangle size={13} /> Contrôle <strong>hors contrat</strong> — crée une intervention à la date choisie.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input type="date" className="form-input form-input--plain"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Heure *</label>
              <input type="time" className="form-input form-input--plain"
                value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Intervenant</label>
            <select className="form-input form-input--plain" value={form.technicienId}
              onChange={e => setForm(f => ({ ...f, technicienId: e.target.value }))}>
              <option value="">— Non assigné</option>
              {pickable.map(u => <option key={u._id} value={u._id}>{u.fullName || u.username}</option>)}
            </select>
          </div>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer" style={{ paddingTop: 0 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Planifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── CONTROLS TAB (interventions liées à l'installation) ─────── */
function ControlsTab({ installation, users }) {
  const navigate = useNavigate()
  const [controls, setControls] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    getInterventions({ installation: installation._id })
      .then(data => setControls(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [installation._id])

  useEffect(() => { load() }, [load])

  function handleCreated() { setModal(null); load() }
  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!window.confirm('Supprimer ce contrôle ?')) return
    try {
      await deleteIntervention(id)
      setControls(prev => prev.filter(c => c._id !== id))
      toast.success('Contrôle supprimé.')
    } catch (err) { toast.error(err.message || 'Erreur.') }
  }

  const upcoming  = controls.filter(c => c.status !== 'termine')
  const completed = controls.filter(c => c.status === 'termine')

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  const renderCard = c => {
    const st   = INTERVENTION_STATUS[c.status] || INTERVENTION_STATUS.planifie
    const done = c.status === 'termine'
    const days = done ? null : daysUntil(c.scheduledDate)
    const urgCls = done ? 'ctrl-card--done' : days < 0 ? 'ctrl-card--overdue' : days <= 30 ? 'ctrl-card--soon' : ''
    return (
      <div key={c._id} className={`ctrl-card ctrl-card--clickable ${urgCls}`}
        onClick={() => navigate(`/interventions/${c._id}`)}>
        <div className="ctrl-card-left">
          <span className={`ctrl-type-badge ctrl-type-badge--${c.controlType}`}>
            {CONTROL_TYPE_LABELS[c.controlType] || 'Hors contrat'}
          </span>
          <span className="ctrl-date">{formatDate(done ? (c.completedDate || c.scheduledDate) : c.scheduledDate)}</span>
          {!done && days != null && (
            <span className={`ctrl-days ${days < 0 ? 'ctrl-days--red' : days <= 30 ? 'ctrl-days--amber' : 'ctrl-days--green'}`}>
              {days < 0 ? `Dépassé de ${Math.abs(days)} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}
            </span>
          )}
          {c.technicienName && <span className="ctrl-tech"><User size={11} /> {c.technicienName}</span>}
        </div>
        <div className="ctrl-card-actions">
          <span className={st.cls}>{st.label}</span>
          <button className="btn btn--ghost btn--sm" onClick={e => handleDelete(c._id, e)}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ctrl-tab">
      <div className="ctrl-tab-bar">
        <div className="ctrl-tab-counts">
          <span className="ctrl-count-chip ctrl-count-chip--upcoming">{upcoming.length} à venir</span>
          <span className="ctrl-count-chip ctrl-count-chip--done">{completed.length} terminé{completed.length > 1 ? 's' : ''}</span>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
          <Plus size={13} /> Planifier
        </button>
      </div>

      {controls.length === 0 && (
        <div className="ctrl-empty">
          <ClipboardList size={40} color="var(--gray-300)" />
          <p>Aucun contrôle enregistré pour cette installation.</p>
          <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={13} /> Planifier le premier contrôle
          </button>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title"><Clock size={14} /> À venir</h4>
          <div className="ctrl-list">{upcoming.map(renderCard)}</div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title"><CheckCircle2 size={14} /> Terminés</h4>
          <div className="ctrl-list">{completed.map(renderCard)}</div>
        </section>
      )}

      {modal?.mode === 'create' && (
        <ScheduleControlModal installation={installation} users={users}
          onClose={() => setModal(null)} onCreated={handleCreated} />
      )}
    </div>
  )
}

/* ─── DELETE MODAL ───────────────────────────────────────────── */
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
          <div className="destroy-warning"><AlertTriangle size={18} /><p>Cette action est <strong>irréversible</strong>.</p></div>
          <p className="delete-confirm-text" style={{ marginTop: 12 }}>
            Supprimer <strong>{inst.clientName}</strong> — {inst.address}
            {inst.location ? ` (${inst.location})` : ''} ?
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--danger" onClick={handleConfirm} disabled={loading}>
            {loading && <span className="spinner spinner--sm" />} Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── PAGE ───────────────────────────────────────────────────── */

const TABS = [
  { id: 'details',   label: 'Détails',    icon: Zap },
  { id: 'controles', label: 'Contrôles',  icon: ClipboardList },
]

export default function InstallationDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [inst,       setInst]      = useState(null)
  const [loading,    setLoading]   = useState(true)
  const [deleteOpen, setDel]       = useState(false)
  const [activeTab,  setActiveTab] = useState('details')
  const [users,      setUsers]     = useState([])

  const canManage = user?.role === 'superadmin' || user?.role === 'admin'
    || user?.permissions?.canManageDevices

  useEffect(() => {
    getInstallation(id)
      .then(setInst)
      .catch(err => { toast.error(err.message); navigate('/devices') })
      .finally(() => setLoading(false))
    getUsers().then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {})
  }, [id, navigate])

  async function handleDelete() {
    await deleteInstallation(id)
    toast.success('Installation supprimée.')
    navigate('/devices')
  }

  if (loading) return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  if (!inst) return null

  const status     = computeStatus(inst)
  const statusCls  = status === 'expiré' ? 'inst-badge inst-badge--expired' : status === 'attention' ? 'inst-badge inst-badge--warning' : 'inst-badge inst-badge--ok'
  const statusLabel = status === 'expiré' ? 'Expiré' : status === 'attention' ? 'Attention' : 'Actif'

  const firstBatt   = inst.batteries?.[0]
  const level       = firstBatt?.level
  const battCls     = level == null ? '' : level < 25 ? 'batt-bar--red' : level < 50 ? 'batt-bar--amber' : 'batt-bar--green'
  const battTextCls = level == null ? 'text-muted' : level < 25 ? 'inst-pct--red' : level < 50 ? 'inst-pct--amber' : 'inst-pct--green'

  return (
    <div className="page-content inst-detail-page">
      {/* Header */}
      <div className="page-header">
        <div className="inst-detail-header-main">
          <button className="back-btn" onClick={() => navigate('/devices')}><ArrowLeft size={16} /></button>
          <button type="button" className="page-title inst-detail-title"
            onClick={() => inst.client?._id && navigate(`/clients/${inst.client._id}`)}
            disabled={!inst.client?._id}>
            <Zap size={18} strokeWidth={1.8} />
            {inst.client?.name || inst.clientName}
          </button>
          <span className={statusCls}>{statusLabel}</span>
        </div>
        {canManage && (
          <div className="inst-detail-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/devices/${id}/edit`)}>
              <Pencil size={14} /> Modifier
            </button>
            <button className="btn btn--danger btn--sm" onClick={() => setDel(true)}>
              <Trash2 size={14} /> Supprimer
            </button>
          </div>
        )}
      </div>

      {/* Location banner */}
      <div className="inst-location-banner">
        <MapPin size={14} strokeWidth={2} />
        <strong>{inst.address}</strong>
        {inst.location && <><span className="text-muted">·</span> {inst.location}</>}
        {inst.serialNumber && (
          <span className="inst-sn-chip">
            <Zap size={11} /> {inst.deviceType && `${inst.deviceType} / `}{inst.serialNumber}
          </span>
        )}
        {inst.controlType && (
          <span className="inst-ctrl-type-chip">
            <Calendar size={11} /> Contrôle {inst.controlType}
          </span>
        )}
        {inst.contract && (
          <button type="button" className="inst-contract-chip"
            onClick={() => navigate(`/contrats/${inst.contract._id}`)}
            title="Voir le contrat lié">
            <FileText size={11} /> Issu du contrat{inst.contract.contractNumber ? ` ${inst.contract.contractNumber}` : ''}
            <ChevronRight size={11} />
          </button>
        )}
      </div>

      {/* Key metrics */}
      <div className="inst-metrics">
        <div className="inst-metric-card inst-metric-card--battery">
          <div className="inst-metric-label">Niveau batterie</div>
          {level != null ? (
            <>
              <div className={`inst-batt-pct ${battTextCls}`}>{level}%</div>
              <div className="inst-batt-track">
                <div className={`inst-batt-fill ${battCls}`} style={{ width: `${level}%` }} />
              </div>
            </>
          ) : (
            <div className="inst-metric-value inst-metric-value--muted">Non renseigné</div>
          )}
        </div>
        <RelativeDate date={firstBatt?.expiryDate}          label="Expiration batterie" />
        <RelativeDate date={inst.electrodes?.[0]?.expiryDate} label="Expiration électrode" />
        <RelativeDate date={inst.nextControlDate}            label="Prochain contrôle" />
      </div>

      {/* Tabs */}
      <div className="cd-tabs" style={{ marginTop: 4 }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.id}
              className={`cd-tab${activeTab === tab.id ? ' cd-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}>
              <Icon size={14} /> {tab.label}
            </button>
          )
        })}
      </div>

      <div className="cd-tab-content">

        {/* ── Détails ── */}
        {activeTab === 'details' && (
          <div className="inst-sections">
            <div className="inst-section-card">
              <div className="inst-section-title"><Zap size={14} /> Appareil</div>
              <dl className="inst-details-grid">
                {inst.deviceProduct?._id ? (
                  <DetailLink label="Type / Modèle" value={inst.deviceProduct.name}
                    onClick={() => navigate(`/stock/${inst.deviceProduct._id}`)} />
                ) : (
                  <DetailItem label="Type / Modèle" value={inst.deviceType} />
                )}
                <DetailItem label="Numéro de série"     value={inst.serialNumber} />
                <DetailItem label="Date d'installation" value={formatDate(inst.installationDate)} />
                <DetailItem label="Type de contrôle"    value={inst.controlType
                  ? (inst.controlType === 'semestriel' ? 'Semestriel (6 mois)' : 'Annuel (12 mois)')
                  : undefined} />
              </dl>
            </div>

            {(inst.batteries?.length ?? 0) > 0 && inst.batteries.map((b, i) => (
              <div key={i} className="inst-section-card">
                <div className="inst-section-title">
                  <Battery size={14} />
                  Batterie{inst.batteries.length > 1 ? ` ${i + 1}` : ''}
                  {b.product?._id
                    ? <button type="button" className="inst-section-subtitle cell-link"
                        onClick={() => navigate(`/stock/${b.product._id}`)}>{b.product.name}</button>
                    : b.productName && <span className="inst-section-subtitle">{b.productName}</span>}
                </div>
                <dl className="inst-details-grid">
                  <DetailItem label="Niveau"            value={b.level != null ? `${b.level}%` : undefined} />
                  <DetailItem label="Date limite"       value={formatDate(b.expiryDate)} />
                  <DetailItem label="Date d'activation" value={formatDate(b.activationDate)} />
                  <DetailItem label="Notes"             value={b.notes} />
                </dl>
              </div>
            ))}

            {(inst.electrodes?.length ?? 0) > 0 && inst.electrodes.map((e, i) => (
              <div key={i} className="inst-section-card">
                <div className="inst-section-title">
                  <Activity size={14} />
                  Électrode{inst.electrodes.length > 1 ? ` ${i + 1}` : ''}
                  {e.product?._id
                    ? <button type="button" className="inst-section-subtitle cell-link"
                        onClick={() => navigate(`/stock/${e.product._id}`)}>{e.product.name}</button>
                    : e.productName && <span className="inst-section-subtitle">{e.productName}</span>}
                </div>
                <dl className="inst-details-grid">
                  <DetailItem label="Expiration" value={formatDate(e.expiryDate)} />
                  <DetailItem label="Notes"      value={e.notes} />
                </dl>
              </div>
            ))}

            <div className="inst-section-card">
              <div className="inst-section-title"><Calendar size={14} /> Suivi</div>
              <dl className="inst-details-grid">
                <DetailItem label="Prochain contrôle" value={formatDate(inst.nextControlDate)} />
                <DetailItem label="Ajouté par"        value={inst.createdBy?.fullName || inst.createdBy?.username} />
                <DetailItem label="Créé le"           value={formatDate(inst.createdAt)} />
                <DetailItem label="Modifié le"        value={formatDate(inst.updatedAt)} />
              </dl>
            </div>

            {inst.notes && (
              <div className="inst-notes-card">
                <div className="inst-section-title">Notes</div>
                <p className="inst-notes-text">{inst.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Contrôles ── */}
        {activeTab === 'controles' && (
          <ControlsTab installation={inst} users={users} />
        )}

      </div>

      {deleteOpen && (
        <DeleteModal inst={inst} onClose={() => setDel(false)} onConfirm={handleDelete} />
      )}
    </div>
  )
}
