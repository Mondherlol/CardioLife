import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Building2, MapPin, Phone, Mail, ChevronRight, Zap,
  User, FileText, Activity, Info, Pencil, Calendar,
  GraduationCap, ClipboardList, Clock, CheckCircle2,
} from 'lucide-react'
import { getClient } from '../api/clients'
import { getInstallations } from '../api/installations'
import { getInterventions } from '../api/interventions'

/* Type de contrôle → libellé */
const CD_CONTROL_TYPE_LABELS = { semestriel: 'Semestriel', annuel: 'Annuel', hors_contrat: 'Hors contrat' }
import { useLoadingBar } from '../hooks/useLoadingBar'
import ClientModal from '../components/ClientModal'
import FormationsClientTab from '../components/FormationsClientTab'
import ClientDocumentsTab from '../components/ClientDocumentsTab'
import PlanningClientTab from '../components/PlanningClientTab'

/* ── Helpers ──────────────────────────────────────────────── */

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const target = new Date(dateStr)
  const now = new Date()
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((t - n) / 86400000)
}

function computeStatus(inst) {
  const now = new Date()
  const d60 = new Date(now.getTime() + 60 * 86400000)
  const ctrl = inst.nextControlDate ? new Date(inst.nextControlDate) : null
  const firstBatt = inst.batteries?.[0]
  const batt = firstBatt?.expiryDate ? new Date(firstBatt.expiryDate) : null
  const level = firstBatt?.level
  const firstElec = inst.electrodes?.[0]
  const elec = firstElec?.expiryDate ? new Date(firstElec.expiryDate) : null

  if ((ctrl && ctrl < now) || (batt && batt < now) || (elec && elec < now)) return 'expiré'
  if ((level != null && level < 25) || (ctrl && ctrl <= d60)) return 'attention'
  return 'actif'
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

/* ── Sub-components ───────────────────────────────────────── */

function StatusBadge({ inst }) {
  const status = computeStatus(inst)
  const cls = status === 'expiré' ? 'inst-badge inst-badge--expired'
    : status === 'attention' ? 'inst-badge inst-badge--warning'
    : 'inst-badge inst-badge--ok'
  const label = status === 'expiré' ? 'Expiré' : status === 'attention' ? 'Attention' : 'Actif'
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
  const cls = days < 0 ? 'ctrl-date ctrl-date--expired'
    : days <= 60 ? 'ctrl-date ctrl-date--soon'
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

/* ── Main Component ───────────────────────────────────────── */

/* ── Controls tab (client view, read-only) ────────────────── */

function ControlsClientTab({ clientId, installations }) {
  const navigate = useNavigate()
  const [controls, setControls] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    getInterventions({ client: clientId })
      .then(data => setControls(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  const instMap = {}
  installations.forEach(i => { instMap[i._id] = i })

  const upcoming  = controls.filter(c => c.status !== 'termine')
  const completed = controls.filter(c => c.status === 'termine')

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
          {!isDone && <span className="ctrl-upcoming-badge"><Clock size={12} /> À venir</span>}
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
      </div>

      {upcoming.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title"><Clock size={14} /> À venir</h4>
          <div className="ctrl-list">
            {upcoming.map(c => renderCard(c, true))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="ctrl-section">
          <h4 className="ctrl-section-title"><CheckCircle2 size={14} /> Terminés</h4>
          <div className="ctrl-list">
            {completed.map(c => renderCard(c, true))}
          </div>
        </section>
      )}
    </div>
  )
}

const TABS = [
  { id: 'info',         label: 'Informations', icon: Info },
  { id: 'documents',    label: 'Documents',    icon: FileText },
  { id: 'installations',label: 'Installations',icon: MapPin },
  { id: 'appareils',    label: 'Appareils',    icon: Activity },
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
  const [activeTab, setActiveTab]     = useState('info')
  const [editOpen, setEditOpen]       = useState(false)

  useLoadingBar(loading)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [clientData, installationsData] = await Promise.all([
        getClient(id),
        getInstallations({ client: id, limit: 500 }),
      ])
      setClient(clientData)
      setInstallations(Array.isArray(installationsData.data) ? installationsData.data : [])
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

  const location = [client.address?.street, client.address?.city, client.address?.governorate]
    .filter(Boolean).join(', ')

  const activeInst = installations.filter(i => computeStatus(i) === 'actif').length

  return (
    <div className="page-content cd-root">

      {/* ── Header banner ─────────────────────────── */}
      <div className="cd-banner">
        <button className="cd-back-btn" onClick={() => navigate('/clients')}>
          <ArrowLeft size={16} />
        </button>

        <div className="cd-avatar">
          {initials(client.name)}
        </div>

        <div className="cd-banner-info">
          <div className="cd-banner-name">{client.name}</div>
          <div className="cd-banner-meta">
            <span className="cd-type-badge">{client.type}</span>
            <span className="cd-stat-chip">
              <Building2 size={12} /> {installations.length} installation{installations.length !== 1 ? 's' : ''}
            </span>
            {activeInst > 0 && (
              <span className="cd-stat-chip cd-stat-chip--green">
                <Activity size={12} /> {activeInst} actif{activeInst !== 1 ? 's' : ''}
              </span>
            )}
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

        {/* ── Informations ──────────────────────── */}
        {activeTab === 'info' && (
          <div className="cd-info-grid">

            {/* Contacts card */}
            <div className="cd-card">
              <div className="cd-card-title">
                <User size={15} /> Contacts {client.contacts?.length > 1 && `(${client.contacts.length})`}
              </div>
              {(client.contacts || []).length === 0 ? (
                <p className="cd-empty-hint">Aucune information de contact.</p>
              ) : (
                client.contacts.map((p, i) => (
                  <div key={i} className="cd-person-row">
                    <span className="cd-person-name">{p.name || <span className="text-muted">Sans nom</span>}</span>
                    <div className="cd-contact-list">
                      {p.phone && (
                        <a href={`tel:${p.phone}`} className="cd-contact-chip cd-contact-chip--phone">
                          <Phone size={12} /> {p.phone}
                        </a>
                      )}
                      {p.email && (
                        <a href={`mailto:${p.email}`} className="cd-contact-chip cd-contact-chip--mail">
                          <Mail size={12} /> {p.email}
                        </a>
                      )}
                      {!p.phone && !p.email && <span className="cd-empty-hint">Aucune coordonnée</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Address card */}
            <div className="cd-card">
              <div className="cd-card-title">
                <MapPin size={15} /> Adresse
              </div>
              {location ? (
                <>
                  {client.address?.street && (
                    <div className="cd-info-row">
                      <span className="cd-info-label">Rue</span>
                      <span className="cd-info-val">{client.address.street}</span>
                    </div>
                  )}
                  {client.address?.city && (
                    <div className="cd-info-row">
                      <span className="cd-info-label">Ville</span>
                      <span className="cd-info-val">{client.address.city}</span>
                    </div>
                  )}
                  {client.address?.governorate && (
                    <div className="cd-info-row">
                      <span className="cd-info-label">Gouvernorat</span>
                      <span className="cd-info-val">{client.address.governorate}</span>
                    </div>
                  )}
                  {client.address?.gps?.lat && (
                    <div className="cd-info-row">
                      <span className="cd-info-label">GPS</span>
                      <a
                        href={`https://maps.google.com/?q=${client.address.gps.lat},${client.address.gps.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cd-gps-link"
                      >
                        {client.address.gps.lat.toFixed(5)}, {client.address.gps.lng.toFixed(5)}
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <p className="cd-empty-hint">Aucune adresse renseignée.</p>
              )}
            </div>

            {/* Responsables + Notes */}
            <div className="cd-card cd-card--wide">
              <div className="cd-card-title">
                <Info size={15} /> Informations internes
              </div>
              {(client.internalManagers || []).length > 0 && (
                <div className="cd-info-row cd-info-row--list">
                  <span className="cd-info-label">
                    Responsable{client.internalManagers.length > 1 ? 's' : ''} interne{client.internalManagers.length > 1 ? 's' : ''}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    {client.internalManagers.map((p, i) => (
                      <div key={i} className="cd-person-row cd-person-row--flat">
                        <span className="cd-person-name">{p.name || <span className="text-muted">Sans nom</span>}</span>
                        <div className="cd-contact-list">
                          {p.phone && (
                            <a href={`tel:${p.phone}`} className="cd-contact-chip cd-contact-chip--phone">
                              <Phone size={12} /> {p.phone}
                            </a>
                          )}
                          {p.email && (
                            <a href={`mailto:${p.email}`} className="cd-contact-chip cd-contact-chip--mail">
                              <Mail size={12} /> {p.email}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {client.notes ? (
                <div className="cd-info-row cd-info-row--notes">
                  <span className="cd-info-label">Notes</span>
                  <p className="cd-notes-text">{client.notes}</p>
                </div>
              ) : (client.internalManagers || []).length === 0 ? (
                <p className="cd-empty-hint">Aucune note.</p>
              ) : null}
            </div>

          </div>
        )}

        {/* ── Documents ─────────────────────────── */}
        {activeTab === 'documents' && (
          <ClientDocumentsTab clientId={id} />
        )}

        {/* ── Installations ─────────────────────── */}
        {activeTab === 'installations' && (
          <div className="cd-table-tab">
            <div className="cd-tab-header">
              <h3 className="cd-tab-title">Installations ({installations.length})</h3>
            </div>
            {installations.length === 0 ? (
              <div className="cd-tab-empty">
                <Zap size={40} color="var(--gray-300)" />
                <p>Aucune installation enregistrée pour ce client.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Site / Adresse</th>
                      <th>Appareil</th>
                      <th>N° Série</th>
                      <th>Prochain contrôle</th>
                      <th>Statut</th>
                      <th style={{ width: 44 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {installations.map(inst => (
                      <tr
                        key={inst._id}
                        className="table-row-clickable"
                        onClick={() => navigate(`/devices/${inst._id}`)}
                      >
                        <td>
                          <div className="inst-site-cell">
                            <div className="inst-site-client">{inst.location || inst.address}</div>
                            <div className="inst-site-loc">
                              <MapPin size={11} strokeWidth={1.8} />
                              {inst.address}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="inst-device-cell">
                            <div className="inst-device-type">{inst.deviceProduct?.name || inst.deviceType || '—'}</div>
                          </div>
                        </td>
                        <td>
                          {inst.serialNumber
                            ? <span className="inst-sn-chip">{inst.serialNumber}</span>
                            : <span className="text-muted">—</span>
                          }
                        </td>
                        <td><ControlDate date={inst.nextControlDate} /></td>
                        <td><StatusBadge inst={inst} /></td>
                        <td>
                          <button
                            type="button"
                            className="action-btn action-btn--edit"
                            title="Voir"
                            onClick={e => { e.stopPropagation(); navigate(`/devices/${inst._id}`) }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Appareils ─────────────────────────── */}
        {activeTab === 'appareils' && (
          <div className="cd-table-tab">
            <div className="cd-tab-header">
              <h3 className="cd-tab-title">État des appareils ({installations.length})</h3>
            </div>
            {installations.length === 0 ? (
              <div className="cd-tab-empty">
                <Activity size={40} color="var(--gray-300)" />
                <p>Aucun appareil enregistré pour ce client.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Appareil</th>
                      <th>N° Série</th>
                      <th>Batterie</th>
                      <th>Électrode</th>
                      <th>Prochain contrôle</th>
                      <th>Statut</th>
                      <th style={{ width: 44 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {installations.map(inst => (
                      <tr
                        key={inst._id}
                        className="table-row-clickable"
                        onClick={() => navigate(`/devices/${inst._id}`)}
                      >
                        <td>
                          <div className="inst-device-cell">
                            <div className="inst-device-type">{inst.deviceProduct?.name || inst.deviceType || '—'}</div>
                            <div className="inst-device-sn">
                              <MapPin size={11} strokeWidth={1.8} />
                              {inst.location || inst.address || '—'}
                            </div>
                          </div>
                        </td>
                        <td>
                          {inst.serialNumber
                            ? <span className="inst-sn-chip">{inst.serialNumber}</span>
                            : <span className="text-muted">—</span>
                          }
                        </td>
                        <td><BatteryBar level={inst.batteries?.[0]?.level} /></td>
                        <td><ControlDate date={inst.electrodes?.[0]?.expiryDate} /></td>
                        <td><ControlDate date={inst.nextControlDate} /></td>
                        <td><StatusBadge inst={inst} /></td>
                        <td>
                          <button
                            type="button"
                            className="action-btn action-btn--edit"
                            title="Voir"
                            onClick={e => { e.stopPropagation(); navigate(`/devices/${inst._id}`) }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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

      {/* ── Edit modal ────────────────────────────── */}
      {editOpen && (
        <ClientModal
          client={client}
          onClose={() => setEditOpen(false)}
          onSaved={updated => { setClient(updated); setEditOpen(false) }}
        />
      )}

    </div>
  )
}
