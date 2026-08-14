import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Building2, MapPin,
  User, FileText, Activity, Calendar, Pencil,
  GraduationCap, ClipboardList, Clock, CheckCircle2, MinusCircle,
  ChevronRight, AlertTriangle,
} from 'lucide-react'
import { getClient, clientLogoUrl } from '../api/clients'
import { getInstallations } from '../api/installations'
import { getInterventions, closeIntervention } from '../api/interventions'
import { getContracts } from '../api/contracts'

/* Type de contrôle → libellé */
const CD_CONTROL_TYPE_LABELS = { semestriel: 'Semestriel', annuel: 'Annuel', hors_contrat: 'Hors contrat' }
import { useLoadingBar } from '../hooks/useLoadingBar'
import ClientHeaderModal from '../components/ClientHeaderModal'
import FormationsClientTab from '../components/FormationsClientTab'
import ClientDocumentsTab from '../components/ClientDocumentsTab'
import PlanningClientTab from '../components/PlanningClientTab'
import SitesClientTab from '../components/SitesClientTab'

/* ── Helpers ──────────────────────────────────────────────── */

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

/* ── Main Component ───────────────────────────────────────── */

/* ── Controls tab (client view, read-only) ────────────────── */

function ControlsClientTab({ clientId, installations }) {
  const navigate = useNavigate()
  const [controls, setControls] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [closing,  setClosing]  = useState(null)   // id du contrôle en cours de clôture

  useEffect(() => {
    getInterventions({ client: clientId })
      .then(data => setControls(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  /* Un contrôle en retard a souvent été fait sans que la fiche soit remplie :
     on le solde d'un clic, sans passer par la fiche complète. */
  async function closeControl(c, e) {
    e.stopPropagation()
    setClosing(c._id)
    try {
      const updated = await closeIntervention(c._id)
      setControls(list => list.map(x => (x._id === c._id ? { ...x, ...updated } : x)))
      toast.success('Contrôle clôturé.')
    } catch (err) {
      toast.error(err.message || 'Clôture impossible.')
    } finally {
      setClosing(null)
    }
  }

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  const instMap = {}
  installations.forEach(i => { instMap[i._id] = i })

  /* Un contrôle non fait dont la date est passée n'est pas « à venir » : il est
     en retard, et c'est ce qui doit sauter aux yeux en premier.

     Dans chaque groupe, l'entrée la plus proche d'aujourd'hui remonte en tête :
     la prochaine échéance, le retard le plus frais, le dernier contrôle fait. */
  const byDate = key => (a, b) => new Date(a[key] || 0) - new Date(b[key] || 0)

  const pending = controls.filter(c => c.status !== 'termine')
  const overdue = pending
    .filter(c => localDaysUntil(c.scheduledDate) < 0)
    .sort(byDate('scheduledDate')).reverse()
  const upcoming = pending
    .filter(c => localDaysUntil(c.scheduledDate) >= 0)
    .sort(byDate('scheduledDate'))
  const completed = controls
    .filter(c => c.status === 'termine')
    .sort((a, b) =>
      new Date(b.completedDate || b.scheduledDate || 0) - new Date(a.completedDate || a.scheduledDate || 0))

  if (controls.length === 0) {
    return (
      <div className="cd-tab-empty">
        <ClipboardList size={40} color="var(--gray-300)" />
        <p>Aucun contrôle enregistré pour ce client.</p>
      </div>
    )
  }

  function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  function localDaysUntil(d) {
    if (!d) return null
    const target = new Date(d)
    const now = new Date()
    const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
    const n = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.round((t - n) / 86400000)
  }

  const renderCard = (c, showInstallLink) => {
    const days    = localDaysUntil(c.scheduledDate)
    const isDone  = c.status === 'termine'
    const urgCls  = isDone ? 'ctrl-card--done'
      : days < 0 ? 'ctrl-card--overdue'
      : days <= 30 ? 'ctrl-card--soon' : ''
    const instId  = c.installation?._id || c.installation
    const inst     = instMap[instId]
    const instAddr = inst?.location || inst?.address || c.installationSnap?.location || c.installationSnap?.address

    return (
      <div key={c._id} className={`ctrl-card ctrl-card--clickable ${urgCls}`}
        onClick={() => navigate(`/interventions/${c._id}`)}>
        <div className="ctrl-card-left">
          <span className={`ctrl-type-badge ctrl-type-badge--${c.controlType}`}>
            {CD_CONTROL_TYPE_LABELS[c.controlType] || 'Hors contrat'}
          </span>
          <span className="ctrl-date">
            {isDone ? formatDate(c.completedDate || c.scheduledDate) : formatDate(c.scheduledDate)}
          </span>
          {!isDone && days != null && (
            <span className={`ctrl-days ${days < 0 ? 'ctrl-days--red' : days <= 30 ? 'ctrl-days--amber' : 'ctrl-days--green'}`}>
              {days < 0 ? `Dépassé de ${Math.abs(days)} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}
            </span>
          )}
          {c.technicienName && (
            <span className="ctrl-tech"><User size={11} /> {c.technicienName}</span>
          )}
          {showInstallLink && instId && instAddr && (
            <button type="button" className="ctrl-install-link"
              onClick={e => { e.stopPropagation(); navigate(`/devices/${instId}`) }}>
              <MapPin size={11} /> {instAddr}
            </button>
          )}
        </div>
        <div className="ctrl-card-actions">
          {isDone && <span className="ctrl-done-badge"><CheckCircle2 size={12} /> Terminé</span>}
          {!isDone && days < 0 && (
            <>
              <span className="ctrl-late-badge"><AlertTriangle size={12} /> En retard</span>
              <button
                type="button"
                className="btn btn--primary btn--sm ctrl-close-btn"
                title="Marquer ce contrôle comme effectué"
                disabled={closing === c._id}
                onClick={e => closeControl(c, e)}
              >
                {closing === c._id
                  ? <span className="login-btn-spinner" />
                  : <><CheckCircle2 size={13} /> Clôturer</>}
              </button>
            </>
          )}
          {!isDone && days >= 0 && (
            <span className="ctrl-upcoming-badge"><Clock size={12} /> À venir</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ctrl-tab">
      <div className="ctrl-tab-bar">
        <div className="ctrl-tab-counts">
          {overdue.length > 0 && (
            <span className="ctrl-count-chip ctrl-count-chip--late">
              {overdue.length} en retard
            </span>
          )}
          <span className="ctrl-count-chip ctrl-count-chip--upcoming">{upcoming.length} à venir</span>
          <span className="ctrl-count-chip ctrl-count-chip--done">{completed.length} terminé{completed.length > 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Le retard passe avant tout le reste : c'est ce qui appelle une action. */}
      {overdue.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title ctrl-section-title--late">
            <AlertTriangle size={14} /> En retard ({overdue.length})
          </h4>
          <div className="ctrl-list">
            {overdue.map(c => renderCard(c, true))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title"><Clock size={14} /> À venir ({upcoming.length})</h4>
          <div className="ctrl-list">
            {upcoming.map(c => renderCard(c, true))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title"><CheckCircle2 size={14} /> Terminés ({completed.length})</h4>
          <div className="ctrl-list">
            {completed.map(c => renderCard(c, true))}
          </div>
        </section>
      )}
    </div>
  )
}

const TABS = [
  { id: 'sites',        label: 'Sites',        icon: Building2 },
  { id: 'documents',    label: 'Documents',    icon: FileText },
  { id: 'controles',    label: 'Contrôles',    icon: ClipboardList },
  { id: 'planning',     label: 'Planning',     icon: Calendar },
  { id: 'formations',   label: 'Formations',   icon: GraduationCap },
]

export default function ClientDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [client, setClient]           = useState(null)
  const [installations, setInstallations] = useState([])
  const [loading, setLoading]         = useState(true)
  /* L'onglet vit dans l'URL : en revenant d'un contrôle ou d'un site, on
     retrouve l'onglet quitté et non le premier de la liste. */
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = TABS.some(t => t.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'sites'
  const setActiveTab = id => setSearchParams(
    id === 'sites' ? {} : { tab: id },
    { replace: true }
  )
  const [counts, setCounts]           = useState({ sites: 0, deas: 0 })
  const [editOpen, setEditOpen]       = useState(false)
  // Nombre de sites couverts par un contrat actif — résumé du bandeau.
  const [covered, setCovered] = useState(0)

  useLoadingBar(loading)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [clientData, installationsData, contractsData] = await Promise.all([
        getClient(id),
        getInstallations({ client: id, limit: 500 }),
        // Contrats en cours, un par site couvert.
        getContracts({ client: id, status: 'actif', limit: 200 }).catch(() => ({ data: [] })),
      ])
      setClient(clientData)
      setInstallations(Array.isArray(installationsData.data) ? installationsData.data : [])
      setCovered(new Set((contractsData?.data || []).map(c => String(c.site?._id || c.site))).size)
    } catch (err) {
      toast.error(err.message || 'Client introuvable.')
      navigate('/clients')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  if (loading || !client) {
    return (
      <div className="page-content">
        <div className="table-loading"><span className="spinner" /></div>
      </div>
    )
  }

  return (
    <div className="page-content cd-root">

      {/* ── Header banner ─────────────────────────── */}
      <div className="cd-banner">
        <button className="cd-back-btn" onClick={() => navigate('/clients')}>
          <ArrowLeft size={16} />
        </button>

        <div className="cd-avatar">
          {client.logo
            ? <img src={clientLogoUrl(client.logo)} alt="" className="cd-avatar-img" />
            : initials(client.name)}
        </div>

        <div className="cd-banner-info">
          <div className="cd-banner-name">{client.name}</div>
          <div className="cd-banner-meta">
            <span className="cd-stat-chip">
              <Building2 size={12} /> {counts.sites} site{counts.sites !== 1 ? 's' : ''}
            </span>
            <span className="cd-stat-chip cd-stat-chip--green">
              <Activity size={12} /> {counts.deas} DEA
            </span>
            {/* Les contrats sont par site : le bandeau résume, la couverture se
                gère site par site dans l'onglet Sites. */}
            <button
              type="button"
              className={`contract-badge contract-badge--${covered > 0 ? 'on' : 'off'} contract-badge--action`}
              title="Gérer les contrats site par site"
              onClick={() => setActiveTab('sites')}
            >
              {covered > 0
                ? <><CheckCircle2 size={12} /> {covered}/{counts.sites} site{counts.sites !== 1 ? 's' : ''} sous contrat <ChevronRight size={12} /></>
                : <><MinusCircle size={12} /> Aucun site sous contrat <ChevronRight size={12} /></>}
            </button>
            {!client.isActive && (
              <span className="cd-stat-chip cd-stat-chip--red">Archivé</span>
            )}
          </div>
        </div>

        <button className="cd-edit-btn" onClick={() => setEditOpen(true)}>
          <Pencil size={14} /> Modifier
        </button>
      </div>

      {/* ── Tabs ──────────────────────────────────── */}
      <div className="cd-tabs">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={`cd-tab${activeTab === tab.id ? ' cd-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ───────────────────────────── */}
      <div className="cd-body">

        {activeTab === 'sites' && (
          <SitesClientTab clientId={id} onCountChange={setCounts} />
        )}

        {/* ── Documents ─────────────────────────── */}
        {activeTab === 'documents' && (
          <ClientDocumentsTab clientId={id} />
        )}

        {/* ── Contrôles ─────────────────────────── */}
        {activeTab === 'controles' && (
          <ControlsClientTab clientId={id} installations={installations} />
        )}

        {/* ── Planning ──────────────────────────── */}
        {activeTab === 'planning' && (
          <PlanningClientTab clientId={id} clientName={client?.name} />
        )}

        {/* ── Formations ────────────────────────── */}
        {activeTab === 'formations' && (
          <FormationsClientTab clientId={id} clientName={client?.name} />
        )}

      </div>

      {editOpen && (
        <ClientHeaderModal
          client={client}
          onClose={() => setEditOpen(false)}
          onSaved={setClient}
        />
      )}


    </div>
  )
}
