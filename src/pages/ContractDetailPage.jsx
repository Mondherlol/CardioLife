import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Pencil, FileText, Calendar, Zap, MapPin, Clock,
  User, CheckCircle2, ClipboardList, Building2, HeartPulse, Info, Banknote,
  History, RefreshCw, Gift, FileX, AlertTriangle, TrendingUp, Undo2,
} from 'lucide-react'
import {
  getContract, cancelTermination, CONTRACT_STATUSES, formatPrice, renewalLabel,
} from '../api/contracts'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ContractModal from '../components/ContractModal'
import TerminateContractConfirm from '../components/TerminateContractConfirm'

const STATUS_MAP = Object.fromEntries(CONTRACT_STATUSES.map(s => [s.value, s]))

const INSTALL_STATUS = {
  a_installer: { label: 'À installer', cls: 'ct-inst-badge ct-inst-badge--todo' },
  installe:    { label: 'Installé',    cls: 'ct-inst-badge ct-inst-badge--done' },
}
const CONTROL_TYPE_LABELS = { semestriel: 'Semestriel', annuel: 'Annuel', hors_contrat: 'Hors contrat', intervention: 'Intervention', installation: 'Installation' }
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

/* Durée d'une période, lisible : « 1 an », « 6 mois », « 1 an et 3 mois ». */
function durationLabel(start, end) {
  if (!start || !end) return '—'
  const s = new Date(start), e = new Date(end)
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
  if (e.getDate() < s.getDate()) months--
  if (months < 1) return `${Math.max(1, Math.round((e - s) / 86400000))} j`
  const y = Math.floor(months / 12), m = months % 12
  return [y && `${y} an${y > 1 ? 's' : ''}`, m && `${m} mois`].filter(Boolean).join(' et ')
}

const byName = u => (u && typeof u === 'object' ? (u.fullName || u.username) : null)

/* ─── Onglet Historique ───
   Toutes les périodes du contrat — la première puis chaque renouvellement —
   avec leur durée et leur prix, et les événements qui ont modifié le prix ou
   mis fin au contrat. */
function HistoryTab({ contract }) {
  const periods = [...(contract.periods || [])].reverse()
  const now = new Date()

  const events = [
    ...(contract.priceIncreases || []).map(p => ({
      at: p.appliedAt, icon: TrendingUp,
      text: `Hausse de ${Math.round(p.rate * 100)} % : ${formatPrice(p.from)} → ${formatPrice(p.to)}`,
      by: byName(p.appliedBy),
    })),
    ...(contract.termination?.date ? [{
      at: contract.termination.requestedAt, icon: FileX,
      text: `${contract.status === 'resilie' ? 'Résilié' : 'Résiliation programmée'} au ${formatDate(contract.termination.date)}`
        + (contract.termination.reason ? ` — ${contract.termination.reason}` : ''),
      by: byName(contract.termination.requestedBy),
    }] : []),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))

  const billed = (contract.periods || []).reduce((s, p) => s + (p.free ? 0 : Number(p.price) || 0), 0)

  return (
    <>
      <div className="ct-section">
        <h3 className="ct-section-title">
          <History size={15} /> Périodes du contrat
          <span className="ct-inst-count">
            {periods.length} période{periods.length !== 1 ? 's' : ''}
            {billed > 0 && ` · ${formatPrice(Math.round(billed * 1000) / 1000)} facturés`}
          </span>
        </h3>

        {periods.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Ce contrat n'a pas de dates : renseignez son début et son échéance pour suivre ses périodes.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table ct-history-table">
              <thead>
                <tr>
                  <th>Période</th>
                  <th>Durée</th>
                  <th>Prix</th>
                  <th>Type</th>
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p, i) => {
                  const current = new Date(p.start) <= now && now < new Date(p.end)
                  return (
                    <tr key={p._id || i} className={current ? 'ct-history-row--current' : ''}>
                      <td>
                        {formatDate(p.start)} → {formatDate(p.end)}
                        {current && <span className="ct-history-tag ct-history-tag--current">En cours</span>}
                      </td>
                      <td>{durationLabel(p.start, p.end)}</td>
                      <td>
                        {p.free
                          ? <><span className="ct-history-tag ct-history-tag--free"><Gift size={11} /> Offerte</span>
                              {p.price != null && <span className="ct-history-muted"> (tarif {formatPrice(p.price)})</span>}</>
                          : formatPrice(p.price)}
                      </td>
                      <td>
                        {p.kind === 'renouvellement'
                          ? <><RefreshCw size={11} /> Renouvellement{p.auto ? ' auto' : ''}</>
                          : 'Souscription'}
                      </td>
                      <td className="ct-history-muted">
                        {p.auto ? 'Automatique' : (byName(p.createdBy) || '—')}
                        {p.createdAt && <> · {formatDate(p.createdAt)}</>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div className="ct-section">
          <h3 className="ct-section-title"><Clock size={15} /> Événements</h3>
          <div className="ct-history-events">
            {events.map((ev, i) => {
              const Icon = ev.icon
              return (
                <div key={i} className="ct-history-event">
                  <Icon size={13} />
                  <span>{ev.text}</span>
                  <span className="ct-history-muted">{formatDate(ev.at)}{ev.by && ` · ${ev.by}`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
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
  const [ending,   setEnding]   = useState(false)
  const [undoing,  setUndoing]  = useState(false)
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
  const deaPriceOf = new Map((contract.deaPrices || []).map(r => [String(r.dea), r.price]))
  const periods    = contract.periods || []
  const current    = periods[periods.length - 1]
  const isActif    = contract.status === 'actif'
  const scheduled  = isActif && contract.termination?.date

  async function undoTermination() {
    setUndoing(true)
    try {
      await cancelTermination(contract._id)
      toast.success('Résiliation annulée.')
      load()
    } catch (err) { toast.error(err.message || 'Erreur.') }
    finally { setUndoing(false) }
  }

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
        <div style={{ display: 'flex', gap: 8 }}>
          {isActif && !scheduled && (
            <button className="btn btn--danger-ghost" onClick={() => setEnding(true)}>
              <FileX size={14} /> Résilier
            </button>
          )}
          <button className="btn btn--primary" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Modifier
          </button>
        </div>
      </div>

      {scheduled && (
        <div className="ct-term-banner">
          <AlertTriangle size={15} />
          <span>
            Résiliation programmée au <strong>{formatDate(contract.termination.date)}</strong>
            {contract.termination.reason && <> — {contract.termination.reason}</>}.
            Le contrat ne sera pas renouvelé.
          </span>
          <button className="btn btn--ghost btn--sm" onClick={undoTermination} disabled={undoing}>
            <Undo2 size={13} /> Annuler la résiliation
          </button>
        </div>
      )}

      {/* Infos clés */}
      <div className="ct-detail-grid">
        <button type="button" className="ct-detail-tile ct-detail-tile--link"
          onClick={() => siteId && navigate(`/sites/${siteId}`)}>
          <span className="ct-tile-label"><Building2 size={12} /> Site couvert</span>
          <span className="ct-tile-value">{contract.site?.name || contract.siteName || '—'}</span>
          <span className="ct-tile-sub">{contract.client?.name || contract.clientName || ''}</span>
        </button>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Calendar size={12} /> Période en cours</span>
          <span className="ct-tile-value">{formatDate(current?.start || contract.startDate)} → {formatDate(contract.endDate)}</span>
          <span className="ct-tile-sub">
            {periods.length > 1 && `Client depuis le ${formatDate(contract.startDate)} · `}
            {!isActif ? (STATUS_MAP[contract.status]?.label || '')
              : scheduled ? `Résiliation le ${formatDate(contract.termination.date)}`
              : contract.autoRenew !== false
                ? <><RefreshCw size={10} /> Renouvelé auto · {renewalLabel(contract.renewalMonths || 12)}{contract.nextFree && ' · prochaine offerte'}</>
                : 'Sans renouvellement automatique'}
          </span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Banknote size={12} /> Prix</span>
          <span className="ct-tile-value">
            {contract.freePeriod
              ? <span className="ct-history-tag ct-history-tag--free"><Gift size={12} /> Période offerte</span>
              : formatPrice(contract.price)}
          </span>
          <span className="ct-tile-sub">
            {contract.freePeriod && contract.price != null && `Tarif ${formatPrice(contract.price)} · `}
            {deaPriceOf.size > 0 && `Somme de ${deaPriceOf.size} tarif${deaPriceOf.size > 1 ? 's' : ''} par DAE · `}
            {contract.priceIncreases?.length
              ? `+5 % appliqué le ${formatDate(contract.priceIncreases[contract.priceIncreases.length - 1].appliedAt)}`
              : '+5 % deux mois avant le contrôle annuel'}
          </span>
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
        <button className={`cd-tab${tab === 'historique' ? ' cd-tab--active' : ''}`} onClick={() => setTab('historique')}>
          <History size={14} /> Historique
          {periods.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--gray-200)', color: 'var(--text-muted)', borderRadius: 999, padding: '0 6px', marginLeft: 4 }}>
              {periods.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'controles' && <ControlsTab controls={contract.controls} navigate={navigate} />}
      {tab === 'historique' && <HistoryTab contract={contract} />}

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
                        {deaPriceOf.has(String(inst._id)) && (
                          <span className="ct-install-price">{formatPrice(deaPriceOf.get(String(inst._id)))}</span>
                        )}
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

      {ending && (
        <TerminateContractConfirm
          contract={contract}
          siteName={contract.site?.name || contract.siteName || 'ce site'}
          onClose={() => setEnding(false)}
          onDone={() => { setEnding(false); load() }}
        />
      )}

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
