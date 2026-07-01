import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Pencil, FileText, Users, Calendar, Tag, Zap, Package,
  GraduationCap, Boxes, MapPin, Clock, X, Plus, Battery, User, CheckCircle2, Wrench, ClipboardList,
} from 'lucide-react'
import { getContract, CONTRACT_STATUSES } from '../api/contracts'
import { createInstallation } from '../api/installations'
import { getUsers } from '../api/users'
import { useLoadingBar } from '../hooks/useLoadingBar'

const STATUS_MAP = Object.fromEntries(CONTRACT_STATUSES.map(s => [s.value, s]))
const BATTERY_CAT   = 'batterie'
const ELECTRODE_CATS = ['electrodes_adulte', 'electrodes_enfant']
const DEFIB_CAT      = 'defibrillateur'

const INSTALL_STATUS = {
  a_installer: { label: 'À installer', cls: 'ct-inst-badge ct-inst-badge--todo' },
  installe:    { label: 'Installé',    cls: 'ct-inst-badge ct-inst-badge--done' },
}
const CONTROL_TYPE_LABELS = { semestriel: 'Semestriel', annuel: 'Annuel', hors_contrat: 'Hors contrat' }
const INTERV_STATUS = {
  planifie: { label: 'Planifié', cls: 'iv-badge iv-badge--blue' },
  en_cours: { label: 'En cours', cls: 'iv-badge iv-badge--orange' },
  termine:  { label: 'Terminé',  cls: 'iv-badge iv-badge--green' },
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function daysUntil(d) {
  if (!d) return null
  const t = new Date(d), n = new Date()
  return Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000)
}

/* ─── Onglet Contrôles ─── */
function ControlsTab({ controls, navigate }) {
  const list = controls || []
  const upcoming = list.filter(c => c.status !== 'termine')
  const done     = list.filter(c => c.status === 'termine')

  if (list.length === 0) {
    return (
      <div className="ct-section">
        <div className="ctrl-empty" style={{ padding: '32px 0' }}>
          <ClipboardList size={36} color="var(--gray-300)" />
          <p>Aucun contrôle pour ce contrat.</p>
        </div>
      </div>
    )
  }

  const renderCard = c => {
    const st     = INTERV_STATUS[c.status] || INTERV_STATUS.planifie
    const isDone = c.status === 'termine'
    const days   = isDone ? null : daysUntil(c.scheduledDate)
    const urg    = isDone ? 'ctrl-card--done' : days < 0 ? 'ctrl-card--overdue' : days <= 30 ? 'ctrl-card--soon' : ''
    return (
      <div key={c._id} className={`ctrl-card ctrl-card--clickable ${urg}`}
        onClick={() => navigate(`/interventions/${c._id}`)}>
        <div className="ctrl-card-left">
          <span className={`ctrl-type-badge ctrl-type-badge--${c.controlType}`}>
            {CONTROL_TYPE_LABELS[c.controlType] || 'Contrôle'}
          </span>
          <span className="ctrl-date">{formatDate(isDone ? (c.completedDate || c.scheduledDate) : c.scheduledDate)}</span>
          {!isDone && days != null && (
            <span className={`ctrl-days ${days < 0 ? 'ctrl-days--red' : days <= 30 ? 'ctrl-days--amber' : 'ctrl-days--green'}`}>
              {days < 0 ? `Dépassé de ${Math.abs(days)} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}
            </span>
          )}
          <span className="ctrl-tech">
            {c.technicienName
              ? <><User size={11} /> {c.technicienName}</>
              : <span style={{ color: 'var(--text-muted)' }}>Aucun intervenant assigné</span>}
          </span>
        </div>
        <div className="ctrl-card-actions">
          <span className={st.cls}>{st.label}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {upcoming.length > 0 && (
        <div className="ct-section">
          <h3 className="ct-section-title"><Clock size={15} /> Contrôles à venir ({upcoming.length})</h3>
          <div className="ctrl-list">{upcoming.map(renderCard)}</div>
        </div>
      )}
      {done.length > 0 && (
        <div className="ct-section">
          <h3 className="ct-section-title"><CheckCircle2 size={15} /> Contrôles terminés ({done.length})</h3>
          <div className="ctrl-list">{done.map(renderCard)}</div>
        </div>
      )}
    </>
  )
}
function formatPrice(v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toLocaleString('fr-FR')} DT`
}
function todayStr() {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

/* ─── Modal : planifier une pose (crée une installation « à installer ») ─── */
function ScheduleInstallModal({ contract, users, onClose, onCreated }) {
  const defibItems = (contract.lineItems || []).filter(li => li.category === DEFIB_CAT)
  const compItems  = (contract.lineItems || []).filter(li =>
    li.category === BATTERY_CAT || ELECTRODE_CATS.includes(li.category))

  const [deviceKey,  setDeviceKey]  = useState(defibItems[0]?.productName || '')
  const [date,       setDate]       = useState(todayStr())
  const [time,       setTime]       = useState('09:00')
  const [technician, setTechnician] = useState('')
  const [address,    setAddress]    = useState(() => {
    const a = contract.client?.address
    return a ? [a.street, a.city, a.governorate].filter(Boolean).join(', ') : ''
  })
  const [selectedComps, setSelectedComps] = useState(() => new Set(compItems.map((_, i) => i)))
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const techniciens = users.filter(u => u.role === 'technicien')
  const pickable    = techniciens.length ? techniciens : users

  function toggleComp(i) {
    setSelectedComps(prev => {
      const n = new Set(prev)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!address.trim()) return setError("L'adresse est requise.")
    const start = new Date(`${date}T${time || '09:00'}`)
    if (isNaN(start.getTime())) return setError('Date ou heure invalide.')

    const device = defibItems.find(d => d.productName === deviceKey) || defibItems[0]
    const batteries  = []
    const electrodes = []
    compItems.forEach((c, i) => {
      if (!selectedComps.has(i)) return
      const entry = { product: c.product?._id || undefined, productName: c.productName }
      if (c.category === BATTERY_CAT) batteries.push(entry)
      else electrodes.push(entry)
    })

    setLoading(true)
    try {
      const tech = pickable.find(u => u._id === technician)
      await createInstallation({
        status:        'a_installer',
        contract:      contract._id,
        client:        contract.client?._id || contract.client,
        clientName:    contract.clientName || contract.client?.name,
        deviceProduct: device?.product?._id || undefined,
        deviceType:    device?.productName || 'DAE',
        address:       address.trim(),
        scheduledDate: start.toISOString(),
        technician:     tech?._id || undefined,
        technicianName: tech ? (tech.fullName || tech.username) : undefined,
        batteries, electrodes,
      })
      toast.success('Installation planifiée — visible dans le planning.')
      onCreated()
    } catch (err) {
      setError(err.message || 'Erreur.')
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><Zap size={16} /> Planifier l'installation</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {defibItems.length > 1 && (
            <div className="form-group">
              <label className="form-label">Appareil (DAE)</label>
              <select className="form-input form-input--plain" value={deviceKey} onChange={e => setDeviceKey(e.target.value)}>
                {defibItems.map((d, i) => <option key={i} value={d.productName}>{d.productName}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label"><MapPin size={11} /> Adresse du site *</label>
            <input className="form-input form-input--plain" value={address}
              onChange={e => setAddress(e.target.value)} placeholder="Adresse d'installation" required />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input type="date" className="form-input form-input--plain" value={date}
                onChange={e => setDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Heure *</label>
              <input type="time" className="form-input form-input--plain" value={time}
                onChange={e => setTime(e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Intervenant <span className="form-label-opt">(optionnel)</span></label>
            <select className="form-input form-input--plain" value={technician} onChange={e => setTechnician(e.target.value)}>
              <option value="">— En attente d'affectation</option>
              {pickable.map(u => <option key={u._id} value={u._id}>{u.fullName || u.username}</option>)}
            </select>
          </div>

          {compItems.length > 0 && (
            <div className="form-group">
              <label className="form-label">Composants à poser</label>
              <div className="ct-comp-pick">
                {compItems.map((c, i) => (
                  <button type="button" key={i}
                    className={`ct-comp-pick-chip${selectedComps.has(i) ? ' ct-comp-pick-chip--on' : ''}`}
                    onClick={() => toggleComp(i)}>
                    {c.category === BATTERY_CAT ? <Battery size={11} /> : <Zap size={11} />} {c.productName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="login-error"><X size={13} /> {error}</div>}

          <div className="modal-footer" style={{ paddingTop: 0 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Planifier la pose'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ContractDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [contract, setContract] = useState(null)
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [scheduling, setScheduling] = useState(false)
  const [tab, setTab] = useState('details')

  useLoadingBar(loading)

  const load = useCallback(() => {
    getContract(id)
      .then(setContract)
      .catch(err => { toast.error(err.message || 'Contrat introuvable.'); navigate('/contrats') })
      .finally(() => setLoading(false))
  }, [id, navigate])

  useEffect(() => { load() }, [load])
  useEffect(() => { getUsers().then(d => setUsers(Array.isArray(d) ? d : d?.data || [])).catch(() => {}) }, [])

  if (loading) return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  if (!contract) return null

  const status = STATUS_MAP[contract.status]
  const periodLabel = contract.controlPeriodicity === 'semestriel' ? 'Semestriel'
    : contract.controlPeriodicity === 'annuel' ? 'Annuel' : '—'

  const installs = contract.installations || []
  const defibToInstall = (contract.lineItems || [])
    .filter(li => li.category === DEFIB_CAT)
    .reduce((s, li) => s + (Number(li.quantity) || 1), 0)
  const remainingSlots = Math.max(0, defibToInstall - installs.length)

  return (
    <div className="page-content">
      {/* En-tête */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="back-btn" onClick={() => navigate('/contrats')}><ArrowLeft size={16} /></button>
          <div>
            <h1 className="page-title" style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
              {contract.contractNumber || 'Contrat'}
              {status && <span className={`ct-status ${status.cls}`}>{status.label}</span>}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              Maintenance · {contract.client?.name || contract.clientName}
            </p>
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => navigate(`/contrats/${id}/edit`)}>
          <Pencil size={14} /> Modifier
        </button>
      </div>

      {/* Infos clés */}
      <div className="ct-detail-grid">
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Users size={12} /> Client</span>
          <span className="ct-tile-value">{contract.client?.name || contract.clientName || '—'}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Calendar size={12} /> Période</span>
          <span className="ct-tile-value">{formatDate(contract.startDate)} → {formatDate(contract.endDate)}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Clock size={12} /> Contrôles</span>
          <span className="ct-tile-value">{periodLabel}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Tag size={12} /> Valeur estimée</span>
          <span className="ct-tile-value ct-tile-value--accent">{formatPrice(contract.estimatedValue)}</span>
        </div>
      </div>

      {/* Onglets */}
      <div className="cd-tabs" style={{ marginTop: 4, marginBottom: 4 }}>
        <button className={`cd-tab${tab === 'details' ? ' cd-tab--active' : ''}`} onClick={() => setTab('details')}>
          <FileText size={14} /> Détails
        </button>
        <button className={`cd-tab${tab === 'controles' ? ' cd-tab--active' : ''}`} onClick={() => setTab('controles')}>
          <ClipboardList size={14} /> Contrôles
          {contract.controls?.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--gray-200)', color: 'var(--text-muted)', borderRadius: 999, padding: '0 6px', marginLeft: 4 }}>
              {contract.controls.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'controles' && <ControlsTab controls={contract.controls} navigate={navigate} />}

      {tab === 'details' && (<>

      {/* Packs */}
      {contract.packs?.length > 0 && (
        <div className="ct-section">
          <h3 className="ct-section-title"><Boxes size={15} /> Packs inclus</h3>
          <div className="ct-pack-chips">
            {contract.packs.map((p, i) => (
              <span key={i} className="ct-pack-chip"><Boxes size={12} /> {p.name || p.pack?.name || 'Pack'}</span>
            ))}
          </div>
        </div>
      )}

      {/* Installations couvertes */}
      <div className="ct-section">
        <h3 className="ct-section-title">
          <Zap size={15} /> Installations couvertes
          <span className="ct-inst-count">{installs.length}/{defibToInstall} posée(s)</span>
        </h3>

        <div className="ct-install-list">
          {/* Installations créées (à installer / installées) */}
          {installs.map(inst => {
            const st = INSTALL_STATUS[inst.status] || INSTALL_STATUS.installe
            const pending = inst.status === 'a_installer'
            return (
              <div key={inst._id} className="ct-install-card ct-install-card--clickable"
                onClick={() => navigate(`/devices/${inst._id}`)} title="Voir l'installation">
                <span className={`ct-install-icon${pending ? ' ct-install-icon--pending' : ''}`}>
                  {pending ? <Wrench size={14} /> : <Zap size={14} />}
                </span>
                <div className="ct-install-body">
                  <div className="ct-install-title">
                    {inst.deviceType || 'DAE'}
                    <span className={st.cls}>{st.label}</span>
                    {inst.serialNumber && <span className="ct-install-badge">N° {inst.serialNumber}</span>}
                  </div>
                  <div className="ct-install-sub">
                    <MapPin size={11} /> {inst.address || '—'}
                    {pending
                      ? <span> · {inst.scheduledDate ? `Pose : ${formatDate(inst.scheduledDate)}` : 'Pose à planifier'} · {inst.technicianName ? <><User size={10} /> {inst.technicianName}</> : 'aucun intervenant assigné'}</span>
                      : inst.nextControlDate && <span> · Contrôle : {formatDate(inst.nextControlDate)}</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Slots « à installer » non encore planifiés */}
          {Array.from({ length: remainingSlots }).map((_, i) => (
            <button key={`slot${i}`} type="button" className="ct-install-slot"
              onClick={() => setScheduling(true)}>
              <span className="ct-install-slot-icon"><Plus size={15} /></span>
              <div>
                <div className="ct-install-slot-title">Défibrillateur à installer</div>
                <div className="ct-install-slot-sub">Cliquer pour planifier la pose (date, intervenant, composants)</div>
              </div>
            </button>
          ))}

          {installs.length === 0 && remainingSlots === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucun défibrillateur à installer dans ce contrat.</p>
          )}
        </div>
      </div>

      {/* Produits & services */}
      {(contract.lineItems?.length > 0 || contract.services?.length > 0) && (
        <div className="ct-section">
          <h3 className="ct-section-title"><Package size={15} /> Détail des produits & services</h3>
          <table className="table">
            <thead>
              <tr><th>Désignation</th><th>Origine</th><th style={{ width: 70 }}>Qté</th><th style={{ width: 110 }}>Prix U.</th><th style={{ width: 120 }}>Total</th></tr>
            </thead>
            <tbody>
              {contract.lineItems?.map((li, i) => (
                <tr key={`li${i}`}>
                  <td><div className="cell-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={12} color="var(--gray-300)" /> {li.productName}</div></td>
                  <td className="cell-muted">{li.fromPack ? <span className="ct-frompack-chip">pack : {li.fromPack}</span> : 'Produit seul'}</td>
                  <td>{li.quantity}</td>
                  <td className="cell-muted">{formatPrice(li.unitPrice)}</td>
                  <td className="cell-primary" style={{ fontWeight: 600 }}>{formatPrice((Number(li.unitPrice) || 0) * (Number(li.quantity) || 1))}</td>
                </tr>
              ))}
              {contract.services?.map((s, i) => (
                <tr key={`s${i}`}>
                  <td><div className="cell-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GraduationCap size={12} color="var(--orange-500)" /> {s.name}</div></td>
                  <td className="cell-muted">{s.fromPack ? <span className="ct-frompack-chip">pack : {s.fromPack}</span> : 'Service'}</td>
                  <td>—</td>
                  <td className="cell-muted">{formatPrice(s.price)}</td>
                  <td className="cell-primary" style={{ fontWeight: 600 }}>{formatPrice(s.price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Valeur estimée</td>
                <td style={{ fontWeight: 800, color: 'var(--orange-500)' }}>{formatPrice(contract.estimatedValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Notes */}
      {contract.notes && (
        <div className="ct-section">
          <h3 className="ct-section-title"><FileText size={15} /> Notes</h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #475569)', whiteSpace: 'pre-wrap', margin: 0 }}>{contract.notes}</p>
        </div>
      )}

      </>)}

      {scheduling && (
        <ScheduleInstallModal
          contract={contract} users={users}
          onClose={() => setScheduling(false)}
          onCreated={() => { setScheduling(false); load() }}
        />
      )}
    </div>
  )
}
