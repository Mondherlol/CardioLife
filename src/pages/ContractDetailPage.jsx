import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Pencil, FileText, Calendar, Zap, MapPin, Clock,
  User, CheckCircle2, ClipboardList, Building2, HeartPulse, Info,
} from 'lucide-react'
import { getContract, CONTRACT_STATUSES } from '../api/contracts'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ContractModal from '../components/ContractModal'

const STATUS_MAP = Object.fromEntries(CONTRACT_STATUSES.map(s => [s.value, s]))

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

export default function ContractDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [contract, setContract] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState(false)
  const [tab, setTab] = useState('details')

  useLoadingBar(loading)

  const load = useCallback(() => {
    getContract(id)
      .then(setContract)
      .catch(err => { toast.error(err.message || 'Contrat introuvable.'); navigate('/contrats') })
      .finally(() => setLoading(false))
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  if (!contract) return null

  const status   = STATUS_MAP[contract.status]
  const installs = contract.installations || []
  const siteId   = contract.site?._id || contract.site

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
              Maintenance · {contract.site?.name || contract.siteName || 'Site'}
              {' · '}{contract.client?.name || contract.clientName}
            </p>
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Modifier
        </button>
      </div>

      {/* Infos clés */}
      <div className="ct-detail-grid">
        <button type="button" className="ct-detail-tile ct-detail-tile--link"
          onClick={() => siteId && navigate(`/sites/${siteId}`)}>
          <span className="ct-tile-label"><Building2 size={12} /> Site couvert</span>
          <span className="ct-tile-value">{contract.site?.name || contract.siteName || '—'}</span>
          <span className="ct-tile-sub">{contract.client?.name || contract.clientName || ''}</span>
        </button>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Calendar size={12} /> Période</span>
          <span className="ct-tile-value">{formatDate(contract.startDate)} → {formatDate(contract.endDate)}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Clock size={12} /> Contrôles</span>
          <span className="ct-tile-value">Semestriels</span>
          <span className="ct-tile-sub">2 par an · le 2ᵉ vaut annuel</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><HeartPulse size={12} /> DAE couverts</span>
          <span className="ct-tile-value ct-tile-value--accent">{installs.length}</span>
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

        {/* DAE couverts — le parc du client, sans saisie */}
        <div className="ct-section">
          <h3 className="ct-section-title">
            <Zap size={15} /> DAE couverts
            <span className="ct-inst-count">{installs.length} appareil{installs.length !== 1 ? 's' : ''}</span>
          </h3>

          <p className="ct-auto-note ct-auto-note--inline">
            <Info size={14} />
            <span>
              Le contrat couvre l'ensemble du parc posé sur ce site.
              Pour ajouter un appareil, passez par la fiche du site.
            </span>
          </p>

          {installs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Aucun DAE installé chez ce client pour l'instant.
            </p>
          ) : (
            <div className="ct-install-list">
              {installs.map(inst => {
                const st = INSTALL_STATUS[inst.status] || INSTALL_STATUS.installe
                const pending = inst.status === 'a_installer'
                return (
                  <div key={inst._id} className="ct-install-card ct-install-card--clickable"
                    onClick={() => navigate(`/devices/${inst._id}`)} title="Voir l'appareil">
                    <span className={`ct-install-icon${pending ? ' ct-install-icon--pending' : ''}`}>
                      <Zap size={14} />
                    </span>
                    <div className="ct-install-body">
                      <div className="ct-install-title">
                        {inst.deviceType || 'DAE'}
                        <span className={st.cls}>{st.label}</span>
                        {inst.serialNumber && <span className="ct-install-badge">N° {inst.serialNumber}</span>}
                      </div>
                      <div className="ct-install-sub">
                        <MapPin size={11} /> {inst.location || inst.address || '—'}
                        {pending
                          ? <span> · {inst.scheduledDate ? `Pose : ${formatDate(inst.scheduledDate)}` : 'Pose à planifier'}</span>
                          : inst.nextControlDate && <span> · Contrôle : {formatDate(inst.nextControlDate)}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Notes */}
        {contract.notes && (
          <div className="ct-section">
            <h3 className="ct-section-title"><FileText size={15} /> Notes</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #475569)', whiteSpace: 'pre-wrap', margin: 0 }}>{contract.notes}</p>
          </div>
        )}

      </>)}

      {editing && (
        <ContractModal
          contract={contract}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load() }}
        />
      )}
    </div>
  )
}
