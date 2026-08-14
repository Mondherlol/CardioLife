import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Building2, MapPin, Phone, Mail, Pencil, Plus,
  HeartPulse, GraduationCap, ClipboardList, FileText, History,
  Package, User, Clock, CheckCircle2, CalendarDays, Hash,
  BatteryMedium, Zap, AlertTriangle, Users, UserPlus,
  MoreVertical, Trash2, Eye, MinusCircle, ChevronRight,
} from 'lucide-react'
import { getSiteHistory } from '../api/sites'
import { getUsers } from '../api/users'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ClientDocumentsTab from '../components/ClientDocumentsTab'
import SiteModal from '../components/SiteModal'
import DeaModal from '../components/DeaModal'
import DeaItemsModal from '../components/DeaItemsModal'
import DeleteDeaConfirm from '../components/DeleteDeaConfirm'
import ContextMenu from '../components/ContextMenu'
import ContractModal from '../components/ContractModal'
import FormationModal from '../components/FormationModal'
import { FormationRow, FormationsSummary } from '../components/FormationRow'
import { stageOf } from '../lib/formations'
import { formatDate, daysUntil, ItemsButton } from '../components/siteHelpers'

/* ── Libellés ─────────────────────────────────────────────────── */
const CONTROL_TYPE_LABELS = { semestriel: 'Semestriel', annuel: 'Annuel', hors_contrat: 'Hors contrat' }
function fmtLong(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/* ── En-tête d'un onglet ──────────────────────────────────────── */
function TabHeader({ title, hint, action }) {
  return (
    <div className="cd-tab-header">
      <div className="cd-tab-headline">
        <h3 className="cd-tab-title">{title}</h3>
        {hint && <p className="cd-tab-hint">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

function EmptyBox({ icon: Icon, children }) {
  return (
    <div className="cd-tab-empty">
      <Icon size={38} color="var(--gray-300)" />
      <p>{children}</p>
    </div>
  )
}

/* ── Bandeau du droit à formation ─────────────────────────────── */
function TrainingQuota({ training }) {
  const { credit, used, remaining, seatsPerDea, deaCount } = training
  const pct  = credit > 0 ? Math.min((used / credit) * 100, 100) : 0
  const over = remaining < 0
  const tone = over ? 'over' : remaining === 0 ? 'full' : 'ok'

  return (
    <div className={`sd-quota sd-quota--${tone}`}>
      <div className="sd-quota-head">
        <span className="sd-quota-icon"><GraduationCap size={16} /></span>
        <div>
          <div className="sd-quota-title">Droit à formation du site</div>
          <div className="sd-quota-sub">
            {deaCount} DAE × {seatsPerDea} places = <strong>{credit} personnes</strong> formables
          </div>
        </div>
        <div className="sd-quota-figures">
          <span className="sd-quota-used">{used}</span>
          <span className="sd-quota-sep">/</span>
          <span className="sd-quota-credit">{credit}</span>
        </div>
      </div>
      <div className="sd-quota-bar">
        <span className="sd-quota-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="sd-quota-foot">
        {over
          ? <><AlertTriangle size={12} /> Droit dépassé de {Math.abs(remaining)} personne{Math.abs(remaining) > 1 ? 's' : ''}</>
          : <>{remaining} place{remaining !== 1 ? 's' : ''} encore disponible{remaining !== 1 ? 's' : ''}</>}
      </div>
    </div>
  )
}

/* ── Vue d'ensemble ───────────────────────────────────────────── */
function OverviewTab({ site, controls, interventions, act }) {
  const deas = site.deas || []

  // Dernière visite tous types confondus, par DAE.
  const lastVisitByDea = useMemo(() => {
    const out = {}
    ;[...interventions, ...controls]
      .filter(v => v.status === 'termine')
      .forEach(v => {
        const key = String(v.installation || '')
        const d   = v.completedDate || v.scheduledDate
        if (!out[key] || new Date(d) > new Date(out[key])) out[key] = d
      })
    return out
  }, [interventions, controls])

  return (
    <div className="sd-overview">
      <div className="sd-cards-row">
        <section className="sd-card">
          <div className="sd-card-title"><MapPin size={14} /> Coordonnées</div>
          <dl className="sd-def">
            <div><dt>Adresse</dt><dd>{site.address?.street || '—'}</dd></div>
            <div><dt>Ville</dt><dd>{site.address?.city || '—'}</dd></div>
            <div><dt>Gouvernorat</dt><dd>{site.address?.governorate || '—'}</dd></div>
            <div><dt>Créé le</dt><dd>{formatDate(site.createdAt) || '—'}</dd></div>
          </dl>
          {site.notes && <p className="sd-notes">{site.notes}</p>}
          <button className="btn btn--ghost btn--sm" onClick={act.editSite}>
            <Pencil size={13} /> Modifier le site
          </button>
        </section>

        <section className="sd-card">
          <div className="sd-card-title"><Users size={14} /> Responsables du site</div>
          {site.contacts?.length ? (
            <div className="sd-contacts">
              {site.contacts.map((c, i) => (
                <div key={i} className="sd-contact">
                  <span className="sd-contact-avatar">{(c.name || '?').trim().charAt(0).toUpperCase()}</span>
                  <div className="sd-contact-main">
                    <span className="sd-contact-name">{c.name || 'Sans nom'}</span>
                    {c.role && <span className="sd-contact-role">{c.role}</span>}
                    <div className="sd-contact-lines">
                      {c.phone && <a href={`tel:${c.phone}`}><Phone size={10} /> {c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`}><Mail size={10} /> {c.email}</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="sd-muted">Aucun responsable enregistré.</p>
          )}
          <button className="btn btn--ghost btn--sm" onClick={act.editContacts}>
            <UserPlus size={13} /> Gérer les responsables
          </button>
        </section>
      </div>

      <section className="sd-card">
        <div className="sd-card-title sd-card-title--row">
          <span><HeartPulse size={14} /> Parc installé ({deas.length})</span>
          <button className="btn btn--ghost btn--sm" onClick={() => act.addDea()}>
            <Plus size={13} /> Ajouter un DEA
          </button>
        </div>
        {deas.length === 0 ? (
          <p className="sd-muted">Aucun DAE sur ce site.</p>
        ) : (
          <div className="sd-dea-grid">
            {deas.map(dea => {
              const ctrlDays = daysUntil(dea.nextControlDate)
              return (
                <article key={dea._id} className="sd-dea"
                  title="Modifier ce DEA — clic droit pour plus d'actions"
                  onClick={() => act.editDea(dea)}
                  onContextMenu={e => act.deaMenu(e, dea)}>
                  <header className="sd-dea-head">
                    <span className="sd-dea-icon"><HeartPulse size={14} /></span>
                    <span className="sd-dea-type">{dea.deviceType || 'DAE'}</span>
                    {dea.status === 'a_installer' && <span className="dea-pending-tag">À installer</span>}
                    <button type="button" className="sd-dea-menu" title="Actions"
                      onClick={e => { e.stopPropagation(); act.deaMenu(e, dea) }}>
                      <MoreVertical size={14} />
                    </button>
                  </header>
                  <div className="sd-dea-lines">
                    {dea.serialNumber && <span><Hash size={11} /> {dea.serialNumber}</span>}
                    {dea.location && <span><MapPin size={11} /> {dea.location}</span>}
                    <span><CalendarDays size={11} /> Posé le {formatDate(dea.installationDate) || '—'}</span>
                    {lastVisitByDea[String(dea._id)] && (
                      <span><CheckCircle2 size={11} /> Dernière visite {formatDate(lastVisitByDea[String(dea._id)])}</span>
                    )}
                    {dea.nextControlDate && (
                      <span className={ctrlDays < 0 ? 'sd-dea-late' : ''}>
                        <Clock size={11} /> Prochain contrôle {formatDate(dea.nextControlDate)}
                        {ctrlDays < 0 ? ` (dépassé de ${Math.abs(ctrlDays)} j)` : ''}
                      </span>
                    )}
                  </div>
                  {/* Les pastilles ouvrent directement la gestion du consommable. */}
                  <footer className="sd-dea-foot">
                    <ItemsButton full kind="batteries" items={dea.batteries}
                      onClick={() => act.items(dea, 'batteries')} />
                    <ItemsButton full kind="electrodes" items={dea.electrodes}
                      onClick={() => act.items(dea, 'electrodes')} />
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

/* ── Historique : tout ce qui s'est passé sur le site ──────────── */
function TimelineTab({ data, navigate }) {
  const events = useMemo(() => {
    const { site, deaLabels, interventions, controls, formations, replacements, appointments } = data
    const list = []

    ;(site.deas || []).forEach(dea => {
      if (dea.installationDate) {
        list.push({
          date: dea.installationDate, kind: 'installation', icon: HeartPulse,
          title: `Installation — ${deaLabels[String(dea._id)] || 'DAE'}`,
          meta:  dea.technicianName ? `Posé par ${dea.technicianName}` : '',
          onClick: () => navigate(`/devices/${dea._id}`),
        })
      } else if (dea.status === 'a_installer' && dea.scheduledDate) {
        list.push({
          date: dea.scheduledDate, kind: 'installation', icon: HeartPulse,
          title: `Pose planifiée — ${deaLabels[String(dea._id)] || 'DAE'}`,
          meta:  dea.technicianName ? `Intervenant ${dea.technicianName}` : '',
          onClick: () => navigate(`/devices/${dea._id}`),
        })
      }
    })

    interventions.forEach(iv => {
      const done = iv.status === 'termine'
      list.push({
        date: done ? (iv.completedDate || iv.scheduledDate) : iv.scheduledDate,
        kind: done ? 'controle' : 'planifie', icon: ClipboardList,
        title: `${CONTROL_TYPE_LABELS[iv.controlType] || 'Intervention'} — ${done ? 'réalisée' : 'planifiée'}`,
        meta: [deaLabels[String(iv.installation)], iv.technicienName].filter(Boolean).join(' · '),
        onClick: () => navigate(`/interventions/${iv._id}`),
      })
    })

    controls.forEach(c => {
      const done = c.status === 'termine'
      list.push({
        date: done ? (c.completedDate || c.scheduledDate) : c.scheduledDate,
        kind: done ? 'controle' : 'planifie', icon: ClipboardList,
        title: `Contrôle ${CONTROL_TYPE_LABELS[c.type] || ''} — ${done ? 'réalisé' : 'à venir'}`,
        meta: [deaLabels[String(c.installation)], c.technicienName || c.technicien?.fullName].filter(Boolean).join(' · '),
      })
    })

    formations.forEach(f => {
      list.push({
        date: f.date, kind: 'formation', icon: GraduationCap,
        title: `Formation — ${f.title}`,
        meta: [
          stageOf(f).label,
          f.participantsCount ? `${f.participantsCount} personne${f.participantsCount > 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(' · '),
      })
    })

    // Rendez-vous du planning rattachés à un DAE du site (réunions, visites…).
    ;(appointments || []).forEach(a => {
      list.push({
        date: a.start, kind: 'planifie', icon: CalendarDays,
        title: a.title || 'Rendez-vous',
        meta: [deaLabels[String(a.installation)], a.assignedTo?.map(u => u.fullName || u.username).join(', ')]
          .filter(Boolean).join(' · '),
      })
    })

    replacements.forEach(r => {
      list.push({
        date: r.date, kind: 'remplacement', icon: Package,
        title: `${r.label} remplacée${r.label === 'Électrodes' ? 's' : ''}`,
        meta: [r.deaLabel, r.technicien, r.source === 'controle' ? 'lors d\'un contrôle' : 'lors d\'une intervention']
          .filter(Boolean).join(' · '),
        onClick: r.source === 'intervention' ? () => navigate(`/interventions/${r.sourceId}`) : undefined,
      })
    })

    return list
      .filter(e => e.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [data, navigate])

  if (events.length === 0) {
    return <EmptyBox icon={History}>Aucun événement enregistré pour ce site.</EmptyBox>
  }

  return (
    <div className="sd-timeline">
      {events.map((e, i) => {
        const Icon = e.icon
        return (
          <div key={i} className={`sd-tl-row sd-tl-row--${e.kind}${e.onClick ? ' sd-tl-row--link' : ''}`}
            onClick={e.onClick}>
            <div className="sd-tl-marker"><Icon size={13} /></div>
            <div className="sd-tl-body">
              <div className="sd-tl-title">{e.title}</div>
              {e.meta && <div className="sd-tl-meta">{e.meta}</div>}
            </div>
            <div className="sd-tl-date">{fmtLong(e.date)}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Formations du site ───────────────────────────────────────── */
function FormationsTab({ data, onCreate, onEdit }) {
  const { formations, training } = data

  return (
    <div className="sd-section">
      <TabHeader
        title={`Formations (${formations.length})`}
        hint="Chaque DAE posé ouvre droit à 16 places de formation."
        action={<button className="btn btn--primary btn--sm" onClick={onCreate}>
          <Plus size={14} /> Nouvelle formation
        </button>}
      />

      <FormationsSummary formations={formations} onPick={onEdit} />

      <TrainingQuota training={training} />

      {formations.length === 0 ? (
        <EmptyBox icon={GraduationCap}>Aucune formation rattachée à ce site.</EmptyBox>
      ) : (
        <div className="sd-list">
          {/* Ce qui attend une action passe devant : le reste est de l'historique. */}
          {[...formations]
            .sort((a, b) => {
              const rank = { termine: 0, programme: 1, livre: 2, annule: 3 }
              const ra = rank[stageOf(a).id], rb = rank[stageOf(b).id]
              return ra !== rb ? ra - rb : new Date(b.date) - new Date(a.date)
            })
            .map(f => (
              <FormationRow key={f._id} formation={f} showSite={false} onClick={onEdit} />
            ))}
        </div>
      )}
    </div>
  )
}

/* ── Contrôles & interventions ────────────────────────────────── */
function VisitsTab({ data, navigate }) {
  const { deaLabels, interventions, controls } = data

  const rows = useMemo(() => {
    const list = [
      ...interventions.map(iv => ({
        _id: iv._id, kind: 'intervention',
        type: CONTROL_TYPE_LABELS[iv.controlType] || 'Hors contrat',
        done: iv.status === 'termine',
        date: iv.status === 'termine' ? (iv.completedDate || iv.scheduledDate) : iv.scheduledDate,
        dea: deaLabels[String(iv.installation)] || '',
        tech: iv.technicienName || iv.technicien?.fullName || '',
        rapport: iv.rapport,
        link: `/interventions/${iv._id}`,
      })),
      ...controls.map(c => ({
        _id: c._id, kind: 'controle',
        type: CONTROL_TYPE_LABELS[c.type] || 'Contrôle',
        done: c.status === 'termine',
        date: c.status === 'termine' ? (c.completedDate || c.scheduledDate) : c.scheduledDate,
        dea: deaLabels[String(c.installation)] || '',
        tech: c.technicienName || c.technicien?.fullName || '',
        rapport: c.rapport,
        link: null,
      })),
    ]
    return list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  }, [deaLabels, interventions, controls])

  if (rows.length === 0) {
    return <EmptyBox icon={ClipboardList}>Aucun contrôle ni intervention sur ce site.</EmptyBox>
  }

  const upcoming = rows.filter(r => !r.done)
  const done     = rows.filter(r => r.done)

  const render = r => {
    const days = r.done ? null : daysUntil(r.date)
    return (
      <div key={`${r.kind}-${r._id}`}
        className={`sd-row${r.link ? ' sd-row--link' : ''}`}
        onClick={r.link ? () => navigate(r.link) : undefined}>
        <span className="sd-row-icon"><ClipboardList size={15} /></span>
        <div className="sd-row-main">
          <div className="sd-row-title">{r.type}{r.dea ? ` — ${r.dea}` : ''}</div>
          <div className="sd-row-meta">
            <span><CalendarDays size={11} /> {fmtLong(r.date)}</span>
            {r.tech && <span><User size={11} /> {r.tech}</span>}
            {r.rapport?.observations && <span title={r.rapport.observations}>« {r.rapport.observations.slice(0, 60)} »</span>}
          </div>
        </div>
        {!r.done && days != null && (
          <span className={`sd-chip ${days < 0 ? 'sd-chip--red' : days <= 30 ? 'sd-chip--amber' : 'sd-chip--blue'}`}>
            {days < 0 ? `Dépassé de ${Math.abs(days)} j` : days === 0 ? "Aujourd'hui" : `Dans ${days} j`}
          </span>
        )}
        <span className={`sd-chip ${r.done ? 'sd-chip--green' : 'sd-chip--blue'}`}>
          {r.done ? <><CheckCircle2 size={11} /> Réalisé</> : <><Clock size={11} /> À venir</>}
        </span>
      </div>
    )
  }

  return (
    <div className="sd-section">
      {upcoming.length > 0 && (
        <>
          <h4 className="sd-sub-title"><Clock size={14} /> À venir ({upcoming.length})</h4>
          <div className="sd-list">{upcoming.map(render)}</div>
        </>
      )}
      {done.length > 0 && (
        <>
          <h4 className="sd-sub-title"><CheckCircle2 size={14} /> Historique ({done.length})</h4>
          <div className="sd-list">{done.map(render)}</div>
        </>
      )}
    </div>
  )
}

/* ── Consommables : ce qui a été remplacé, et ce qui est en place ── */
function ConsumablesTab({ data, navigate }) {
  const { site, replacements, items } = data

  const inPlace = useMemo(() => {
    const rows = []
    ;(site.deas || []).forEach(dea => {
      const label = [dea.deviceType, dea.serialNumber && `n° ${dea.serialNumber}`].filter(Boolean).join(' · ') || 'DAE'
      ;(dea.batteries || []).forEach(b => rows.push({
        kind: 'Batterie', dea: label, name: b.productName, serial: b.serialNumber,
        expiry: b.expiryDate, extra: b.level != null ? `${b.level} %` : '',
      }))
      ;(dea.electrodes || []).forEach(e => rows.push({
        kind: 'Électrodes', dea: label, name: e.productName, serial: e.lotNumber,
        expiry: e.expiryDate, extra: e.kind || '',
      }))
    })
    return rows
  }, [site])

  return (
    <div className="sd-section">
      <h4 className="sd-sub-title"><History size={14} /> Remplacements passés ({replacements.length})</h4>
      {replacements.length === 0 ? (
        <EmptyBox icon={Package}>
          Aucun remplacement consigné. Les pièces marquées « remplacée » dans le rapport
          d'un contrôle ou d'une intervention apparaissent ici.
        </EmptyBox>
      ) : (
        <div className="sd-list">
          {replacements.map((r, i) => (
            <div key={i}
              className={`sd-row${r.source === 'intervention' ? ' sd-row--link' : ''}`}
              onClick={r.source === 'intervention' ? () => navigate(`/interventions/${r.sourceId}`) : undefined}>
              <span className="sd-row-icon"><Package size={15} /></span>
              <div className="sd-row-main">
                <div className="sd-row-title">{r.label} remplacée{r.label === 'Électrodes' ? 's' : ''}</div>
                <div className="sd-row-meta">
                  {r.deaLabel && <span><HeartPulse size={11} /> {r.deaLabel}</span>}
                  {r.technicien && <span><User size={11} /> {r.technicien}</span>}
                  <span>{r.source === 'controle' ? 'Contrôle périodique' : 'Intervention'}</span>
                </div>
              </div>
              <span className="sd-chip sd-chip--slate">{fmtLong(r.date)}</span>
            </div>
          ))}
        </div>
      )}

      <h4 className="sd-sub-title"><BatteryMedium size={14} /> En place aujourd'hui ({inPlace.length})</h4>
      {inPlace.length === 0 ? (
        <p className="sd-muted">Aucun consommable renseigné sur les DAE du site.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th><th>DAE</th><th>Produit</th>
                <th>N° série / lot</th><th>Péremption</th><th></th>
              </tr>
            </thead>
            <tbody>
              {inPlace.map((r, i) => {
                const days = daysUntil(r.expiry)
                return (
                  <tr key={i}>
                    <td>{r.kind}</td>
                    <td className="cell-muted">{r.dea}</td>
                    <td>{r.name || '—'}</td>
                    <td className="cell-muted">{r.serial || '—'}</td>
                    <td className={days != null && days < 0 ? 'sd-dea-late' : ''}>
                      {formatDate(r.expiry) || '—'}
                      {days != null && days < 0 && ' (expiré)'}
                    </td>
                    <td className="cell-muted">{r.extra}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <>
          <h4 className="sd-sub-title"><Package size={14} /> Articles de stock affectés au site ({items.length})</h4>
          <div className="sd-list">
            {items.map(it => (
              <div key={it._id} className="sd-row sd-row--link"
                onClick={() => navigate(`/stock/articles/${it._id}`)}>
                <span className="sd-row-icon"><Package size={15} /></span>
                <div className="sd-row-main">
                  <div className="sd-row-title">{it.product?.name || 'Article'}</div>
                  <div className="sd-row-meta">
                    {it.serialNumber && <span><Hash size={11} /> {it.serialNumber}</span>}
                    {it.lotNumber && <span>Lot {it.lotNumber}</span>}
                    {it.expirationDate && <span>Péremption {formatDate(it.expirationDate)}</span>}
                  </div>
                </div>
                <span className="sd-chip sd-chip--slate">{it.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */
const TABS = [
  { id: 'apercu',       label: "Vue d'ensemble", icon: Building2 },
  { id: 'historique',   label: 'Historique',     icon: History },
  { id: 'formations',   label: 'Formations',     icon: GraduationCap },
  { id: 'controles',    label: 'Contrôles',      icon: ClipboardList },
  { id: 'consommables', label: 'Consommables',   icon: Package },
  { id: 'documents',    label: 'Documents',      icon: FileText },
]

export default function SiteDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('apercu')
  const [users,     setUsers]     = useState([])
  const [editOpen,  setEditOpen]  = useState(false)  // false | true | 'contacts'
  const [fmnModal,  setFmnModal]  = useState(null)   // { mode, entity? }
  const [deaModal,  setDeaModal]  = useState(null)   // { dea } — dea null = création
  const [itemsModal, setItemsModal] = useState(null) // { dea, kind }
  const [deaDeleting, setDeaDeleting] = useState(null)
  const [menu,      setMenu]      = useState(null)   // { x, y, title, items }
  const [ctrModal,  setCtrModal]  = useState(false)  // création du contrat du site

  useLoadingBar(loading)

  const load = useCallback(async () => {
    try {
      setData(await getSiteHistory(id))
    } catch (err) {
      toast.error(err.message || 'Site introuvable.')
      navigate('/clients')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])
  useEffect(() => { getUsers().then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {}) }, [])

  if (loading || !data) {
    return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  }

  const { site, training, formations, interventions, controls, replacements } = data
  const client   = site.client
  const clientId = client?._id || client
  const hasDea   = (site.deas?.length || 0) > 0
  const visitsDone = [...interventions, ...controls].filter(v => v.status === 'termine').length

  /* Tout se modifie depuis cette fiche : la liste des sites du client n'est
     qu'un point d'entrée. */
  const act = {
    editSite:     () => setEditOpen(true),
    editContacts: () => setEditOpen('contacts'),
    addDea:       () => setDeaModal({ dea: null }),
    editDea:      dea => setDeaModal({ dea }),
    items:        (dea, kind) => setItemsModal({ dea, kind }),
    deleteDea:    dea => setDeaDeleting(dea),

    deaMenu(e, dea) {
      e.preventDefault()
      e.stopPropagation()
      setMenu({
        x: e.clientX, y: e.clientY,
        title: `${dea.deviceType || 'DAE'}${dea.location ? ` · ${dea.location}` : ''}`,
        items: [
          { label: 'Modifier ce DEA',      icon: Pencil,        onClick: () => act.editDea(dea) },
          { label: 'Gérer les batteries',  icon: BatteryMedium, onClick: () => act.items(dea, 'batteries') },
          { label: 'Gérer les électrodes', icon: Zap,           onClick: () => act.items(dea, 'electrodes') },
          { label: 'Voir la fiche du DAE', icon: Eye,           onClick: () => navigate(`/devices/${dea._id}`) },
          { separator: true },
          { label: 'Ajouter un DEA sur ce site', icon: Plus,     onClick: () => act.addDea() },
          { label: 'Modifier les responsables',  icon: UserPlus, onClick: () => act.editContacts() },
          { separator: true },
          { label: 'Retirer ce DEA', icon: Trash2, danger: true, onClick: () => act.deleteDea(dea) },
        ],
      })
    },
  }

  const stats = [
    { key: 'deas',  icon: HeartPulse,     label: 'DAE installés',  value: site.deas?.length || 0 },
    { key: 'ctrl',  icon: ClipboardList,  label: 'Visites réalisées', value: visitsDone },
    { key: 'fmn',   icon: GraduationCap,  label: 'Formations',     value: formations.length },
    { key: 'seats', icon: Users,          label: 'Personnes formées', value: `${training.used} / ${training.credit}` },
    { key: 'conso', icon: Package,        label: 'Remplacements',  value: replacements.length },
  ]

  return (
    <div className="page-content cd-root">

      {/* ── Bandeau ── */}
      <div className="cd-banner">
        <button className="cd-back-btn"
          onClick={() => navigate(clientId ? `/clients/${clientId}` : '/clients')}>
          <ArrowLeft size={16} />
        </button>

        <div className="cd-avatar cd-avatar--site"><Building2 size={22} /></div>

        <div className="cd-banner-info">
          <div className="cd-banner-name">{site.name}</div>
          <div className="cd-banner-meta">
            {client?.name && (
              <button type="button" className="cd-stat-chip cd-stat-chip--link"
                onClick={() => navigate(`/clients/${clientId}`)}>
                <Building2 size={12} /> {client.name}
              </button>
            )}
            {(site.address?.street || site.address?.city) && (
              <span className="cd-stat-chip">
                <MapPin size={12} /> {[site.address?.street, site.address?.city].filter(Boolean).join(', ')}
              </span>
            )}
            <span className="cd-stat-chip cd-stat-chip--green">
              <HeartPulse size={12} /> {site.deas?.length || 0} DAE
            </span>
            {/* Le contrat est propre au site : c'est lui qui cadence ses visites. */}
            <button
              type="button"
              className={`contract-badge contract-badge--${data.contract ? 'on' : 'off'} contract-badge--action`}
              title={data.contract
                ? `Voir le contrat ${data.contract.contractNumber || ''}`.trim()
                : hasDea
                  ? 'Créer le contrat de maintenance de ce site'
                  : 'Posez un DAE avant de créer un contrat'}
              onClick={() => data.contract
                ? navigate(`/contrats/${data.contract._id}`)
                : hasDea
                  ? setCtrModal(true)
                  : toast.info("Posez d'abord un DAE sur ce site : un contrat sans appareil n'a rien à contrôler.")}
            >
              {data.contract
                ? <><FileText size={12} /> {data.contract.contractNumber || 'Sous contrat'} <ChevronRight size={12} /></>
                : <><MinusCircle size={12} /> Hors contrat {hasDea && <Plus size={12} />}</>}
            </button>
            {!site.isActive && <span className="cd-stat-chip cd-stat-chip--red">Archivé</span>}
          </div>
        </div>

        <button className="cd-edit-btn" onClick={() => setEditOpen(true)}>
          <Pencil size={14} /> Modifier
        </button>
      </div>

      {/* ── Indicateurs ── */}
      <div className="sd-stats">
        {stats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.key} className="sd-stat">
              <span className="sd-stat-icon"><Icon size={15} /></span>
              <span className="sd-stat-value">{s.value}</span>
              <span className="sd-stat-label">{s.label}</span>
            </div>
          )
        })}
      </div>

      {/* ── Onglets ── */}
      <div className="cd-tabs">
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

      <div className="cd-body">
        {activeTab === 'apercu' && (
          <OverviewTab site={site} controls={controls} interventions={interventions} act={act} />
        )}
        {activeTab === 'historique'   && <TimelineTab data={data} navigate={navigate} />}
        {activeTab === 'formations'   && (
          <FormationsTab
            data={data}
            onCreate={() => setFmnModal({ mode: 'create' })}
            onEdit={f => setFmnModal({ mode: 'edit', entity: f })}
          />
        )}
        {activeTab === 'controles'    && <VisitsTab data={data} navigate={navigate} />}
        {activeTab === 'consommables' && <ConsumablesTab data={data} navigate={navigate} />}
        {activeTab === 'documents'    && (
          <ClientDocumentsTab siteId={id} title={`Documents — ${site.name}`} />
        )}
      </div>

      {editOpen && (
        <SiteModal
          clientId={clientId}
          site={site}
          focus={editOpen === 'contacts' ? 'contacts' : undefined}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load() }}
        />
      )}

      {deaModal && (
        <DeaModal
          site={site}
          dea={deaModal.dea}
          contract={data.contract}
          onClose={() => setDeaModal(null)}
          onSaved={() => { setDeaModal(null); load() }}
        />
      )}

      {itemsModal && (
        <DeaItemsModal
          site={site}
          dea={itemsModal.dea}
          kind={itemsModal.kind}
          onClose={() => setItemsModal(null)}
          onSaved={() => { setItemsModal(null); load() }}
        />
      )}

      {deaDeleting && (
        <DeleteDeaConfirm
          site={site}
          dea={deaDeleting}
          onClose={() => setDeaDeleting(null)}
          onDone={() => { setDeaDeleting(null); load() }}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y} title={menu.title} items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}

      {ctrModal && (
        <ContractModal
          site={site}
          onClose={() => setCtrModal(false)}
          onSaved={saved => { setCtrModal(false); navigate(`/contrats/${saved._id}`) }}
        />
      )}

      {fmnModal && (
        <FormationModal
          mode={fmnModal.mode}
          formation={fmnModal.entity}
          presetClient={{ id: clientId, name: client?.name || site.clientName }}
          presetSite={{ id: site._id, name: site.name }}
          quota={training}
          users={users}
          onClose={() => setFmnModal(null)}
          onSaved={() => { setFmnModal(null); load() }}
          onChanged={() => load()}
          onDeleted={() => { setFmnModal(null); load() }}
        />
      )}
    </div>
  )
}
