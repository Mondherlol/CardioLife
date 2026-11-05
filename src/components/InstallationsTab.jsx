import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  HeartPulse, Search, X, MapPin, User, Calendar, CheckCircle2,
  Clock, AlertTriangle, PlayCircle, Plus, FileText, GraduationCap, CalendarClock, Archive,
} from 'lucide-react'
import { getInstallations } from '../api/installations'
import { getInterventions } from '../api/interventions'
import InstallationCompleteModal from './InstallationCompleteModal'
import InstallationPlanModal from './InstallationPlanModal'
import ListFooter from './ListFooter'
import { useProgressiveList } from '../hooks/useInfiniteList'
import { useAuth } from '../context/AuthContext'
import { isAdmin } from '../lib/access'
import { fold } from '../lib/text'

/* Une installation est une visite (`Intervention`, type « installation ») :
   elle se programme, se démarre, se remplit — une fiche et des photos par
   appareil — puis se clôture, ce qui fait entrer les appareils au parc. */
const STATUS = {
  planifie: { label: 'À faire',  cls: 'iv-badge iv-badge--blue',   Icon: Clock },
  en_cours: { label: 'En cours', cls: 'iv-badge iv-badge--orange', Icon: PlayCircle },
  termine:  { label: 'Faite',    cls: 'iv-badge iv-badge--green',  Icon: CheckCircle2 },
}

const FILTERS = [
  { value: '',         label: 'Toutes' },
  { value: 'planifie', label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine',  label: 'Faites' },
  // Le parc saisi ou importé sans visite d'installation : consultable à part,
  // il ne se mélange pas au travail à faire.
  { value: 'reprise',  label: 'Reprises de parc' },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(d) {
  return d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
}

function StatusBadge({ status }) {
  const m = STATUS[status] || STATUS.planifie
  const { Icon } = m
  return <span className={m.cls}><Icon size={11} strokeWidth={2.5} /> {m.label}</span>
}

const RENDER_STEP = 50
const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0))

export default function InstallationsTab({ embedded = false }) {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const canReport = isAdmin(user) || !!user?.permissions?.canManageDevices
  const canPlan   = canReport || !!user?.permissions?.canManageInterventions

  const [visits,  setVisits]  = useState([])   // visites d'installation
  const [parc,    setParc]    = useState([])   // DEA du parc (poses en attente, reprises)
  const [loading, setLoading] = useState(true)
  const [denied,  setDenied]  = useState(false)
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('')
  const [posing,  setPosing]  = useState(null)
  const [planning, setPlanning] = useState(null) // null | { client?, deas? }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ivs, res] = await Promise.all([
        getInterventions({ controlType: 'installation', light: '1' }),
        getInstallations({ limit: 5000 }).catch(err => { if (err.status === 403) return { data: [] }; throw err }),
      ])
      setVisits(Array.isArray(ivs) ? ivs : [])
      setParc(Array.isArray(res) ? res : (res?.data || []))
      setDenied(false)
    } catch (err) {
      if (err.status === 403) setDenied(true)
      else toast.error(err.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /* Poses prévues sans visite à venir : planifiées avant les visites
     d'installation, ou appareil resté non posé lors du passage. Elles
     attendent d'être (re)programmées. */
  const toSchedule = useMemo(() => parc
    .filter(d => d.status === 'a_installer' && (!d.visit || d.visit.status === 'termine'))
    .sort((a, b) => new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0)), [parc])

  // Le parc entré sans visite d'installation (saisie, import du fichier).
  const reprises = useMemo(() => parc.filter(d => d.status === 'installe' && !d.visit), [parc])

  const stats = useMemo(() => ({
    total:    visits.length,
    planifie: visits.filter(v => v.status === 'planifie').length,
    en_cours: visits.filter(v => v.status === 'en_cours').length,
    termine:  visits.filter(v => v.status === 'termine').length,
    reprise:  reprises.length,
  }), [visits, reprises])

  const q = fold(search.trim())

  const filteredVisits = useMemo(() => {
    let list = visits
    if (filter && filter !== 'reprise') list = list.filter(v => v.status === filter)
    if (q) {
      list = list.filter(v =>
        fold(v.clientName).includes(q) ||
        fold(v.siteName).includes(q) ||
        fold(v.objet).includes(q) ||
        fold(v.installationSnap?.serialNumber).includes(q) ||
        fold(v.technicienName).includes(q))
    }
    // Le travail à faire d'abord (le plus proche en tête), puis l'historique.
    const rank = { en_cours: 0, planifie: 1, termine: 2 }
    return [...list].sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
      if (a.status === 'termine') return new Date(b.completedDate || 0) - new Date(a.completedDate || 0)
      return new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0)
    })
  }, [visits, filter, q])

  const filteredReprises = useMemo(() => {
    if (filter !== 'reprise') return []
    const list = q ? reprises.filter(r =>
      fold(r.clientName).includes(q) ||
      fold(r.address).includes(q) ||
      fold(r.deviceType).includes(q) ||
      fold(r.serialNumber).includes(q)) : reprises
    return [...list].sort((a, b) => new Date(b.installationDate || 0) - new Date(a.installationDate || 0))
  }, [reprises, filter, q])

  const rows = filter === 'reprise' ? filteredReprises : filteredVisits
  const progressive = useProgressiveList(rows, { step: RENDER_STEP, resetKey: `${search}|${filter}` })

  if (denied) {
    return (
      <div className="ctrl-empty">
        <HeartPulse size={40} color="var(--gray-300)" />
        <p>Vous n'avez pas accès aux installations.</p>
      </div>
    )
  }

  const pendingCount = stats.planifie + stats.en_cours

  return (
    <div className={embedded ? 'mt-tab-panel' : 'page-content'}>
      <div className="page-header">
        <div>
          {!embedded && <h1 className="page-title"><HeartPulse size={20} /> Installations</h1>}
          <p className="page-subtitle">
            {stats.total} installation{stats.total !== 1 ? 's' : ''} programmée{stats.total !== 1 ? 's' : ''}
            {pendingCount > 0 && ` · ${pendingCount} à réaliser`}
            {toSchedule.length > 0 && ` · ${toSchedule.length} pose${toSchedule.length > 1 ? 's' : ''} à programmer`}
          </p>
        </div>
        {canPlan && (
          <button className="btn btn--primary" onClick={() => setPlanning({})}>
            <Plus size={14} /> Programmer une installation
          </button>
        )}
      </div>

      <div className="inst-stats">
        <div className="inst-stat-card">
          <div className="inst-stat-num">{stats.total}</div>
          <div className="inst-stat-label">Total</div>
        </div>
        <div className="inst-stat-card inst-stat-card--blue">
          <div className="inst-stat-num">{stats.planifie}</div>
          <div className="inst-stat-label">À faire</div>
        </div>
        <div className="inst-stat-card inst-stat-card--amber">
          <div className="inst-stat-num">{stats.en_cours}</div>
          <div className="inst-stat-label">En cours</div>
        </div>
        <div className="inst-stat-card inst-stat-card--green">
          <div className="inst-stat-num">{stats.termine}</div>
          <div className="inst-stat-label">Faites</div>
        </div>
      </div>

      {/* Poses en attente de programmation : c'est du matériel promis au
          client qui n'a pas encore de date de passage. */}
      {!loading && toSchedule.length > 0 && (
        <div className="inst-toschedule">
          <div className="inst-toschedule-title">
            <AlertTriangle size={14} /> Poses à programmer ({toSchedule.length})
          </div>
          <div className="inst-toschedule-list">
            {toSchedule.map(d => (
              <div key={d._id} className="inst-toschedule-row">
                <span className="inst-toschedule-main" onClick={() => navigate(`/devices/${d._id}`)}>
                  <strong>{d.clientName || '—'}</strong>
                  <span>{[d.site?.name, d.deviceType, d.serialNumber].filter(Boolean).join(' · ')}</span>
                  {d.visit?.nonPose && <em>non posé lors de la visite du {fmt(d.visit.completedDate || d.visit.scheduledDate)}</em>}
                  {!d.visit && d.scheduledDate && <em>prévue le {fmt(d.scheduledDate)}, sans visite</em>}
                </span>
                {canPlan && (
                  <button className="btn btn--ghost btn--sm" onClick={() => setPlanning({
                    client: { id: d.client?._id || d.client, name: d.clientName }, deas: [d], site: d.site,
                  })}>
                    <CalendarClock size={13} /> Programmer
                  </button>
                )}
                {canReport && (
                  <button className="btn btn--ghost btn--sm" title="Valider la pose sans visite (régularisation)"
                    onClick={() => setPosing(d)}>
                    <CheckCircle2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
              {f.value === 'reprise' && <Archive size={11} style={{ marginRight: 4 }} />}
              {f.label}
              {f.value && <span className="inst-filter-count">{stats[f.value] ?? 0}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : filter === 'reprise' ? (
        <div className="table-wrap">
          <p className="form-hint" style={{ margin: '0 0 8px' }}>
            Appareils entrés au parc sans visite d'installation (saisie manuelle, import du fichier).
          </p>
          <table className="table">
            <thead>
              <tr><th>Client / Site</th><th>DAE</th><th>Posé le</th></tr>
            </thead>
            <tbody>
              {progressive.visible.map(inst => (
                <tr key={inst._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${inst._id}`)}>
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
                    </div>
                  </td>
                  <td>{inst.installationDate ? fmt(inst.installationDate) : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={3} className="table-empty">Aucun appareil repris pour ces critères.</td></tr>
              )}
            </tbody>
          </table>
          {rows.length > 0 && (
            <ListFooter sentinelRef={progressive.sentinelRef} shown={progressive.shown} total={rows.length}
              hasMore={progressive.hasMore} noun={['appareil', 'appareils']} />
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client / Site</th>
                <th>Appareils</th>
                <th>Technicien</th>
                <th>Prévue</th>
                <th>Faite</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {progressive.visible.map(v => {
                const late = v.status !== 'termine' && v.scheduledDate && new Date(v.scheduledDate) < startOfToday()
                const n = v.targets?.length || 1
                return (
                  <tr key={v._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/interventions/${v._id}`)}>
                    <td>
                      <div className="inst-site-cell">
                        <div className="inst-site-client">{v.clientName || '—'}</div>
                        {v.siteName && (
                          <div className="inst-site-loc"><MapPin size={11} strokeWidth={1.8} /> {v.siteName}</div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="inst-device-cell">
                        <span className="inst-device-type">
                          {n > 1 ? `${n} DAE` : (v.installationSnap?.deviceType || 'DAE')}
                        </span>
                        {n === 1 && v.installationSnap?.serialNumber && (
                          <span className="inst-device-sn">{v.installationSnap.serialNumber}</span>
                        )}
                        {v.formation?.formation && (
                          <span className="inst-device-sn" title="Formation des agents liée">
                            <GraduationCap size={11} /> + formation
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="iv-tech-cell">
                        <User size={12} strokeWidth={1.8} />
                        {v.technicienName || v.technicien?.fullName || <em className="text-muted">Non assigné</em>}
                      </div>
                    </td>
                    <td>
                      {v.scheduledDate ? (
                        <div className={`iv-date-cell${late ? ' iv-card-date--late' : ''}`}>
                          <Calendar size={12} strokeWidth={1.8} />
                          {fmt(v.scheduledDate)} {fmtTime(v.scheduledDate)}
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {v.completedDate ? (
                        <div className="iv-date-cell"><CheckCircle2 size={12} strokeWidth={1.8} /> {fmt(v.completedDate)}</div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td><StatusBadge status={v.status} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="btn btn--ghost btn--sm" title="Bon d'intervention"
                        onClick={() => window.open(`/interventions/${v._id}/bon`, '_blank')}>
                        <FileText size={13} /> Bon
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="table-empty">
                  {search || filter
                    ? 'Aucune installation pour ces critères.'
                    : 'Aucune installation programmée. Programmez-en une depuis cet onglet, le planning ou la fiche client.'}
                </td></tr>
              )}
            </tbody>
          </table>

          {rows.length > 0 && (
            <ListFooter
              sentinelRef={progressive.sentinelRef}
              shown={progressive.shown}
              total={rows.length}
              hasMore={progressive.hasMore}
              noun={['installation', 'installations']}
            />
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

      {planning && (
        <InstallationPlanModal
          clientId={planning.client?.id}
          clientName={planning.client?.name}
          site={planning.site}
          presetDeas={planning.deas || []}
          onClose={() => setPlanning(null)}
          onDone={created => {
            setPlanning(null)
            load()
            if (created?._id) navigate(`/interventions/${created._id}`)
          }}
        />
      )}
    </div>
  )
}
