import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin   from '@fullcalendar/daygrid'
import timeGridPlugin  from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin      from '@fullcalendar/list'
import frLocale        from '@fullcalendar/core/locales/fr'
import { Plus, Wrench, Zap, CalendarClock, X, GraduationCap, Hammer, Printer, PauseCircle } from 'lucide-react'
import { toast } from 'react-toastify'
import { getAppointments, updateAppointment } from '../api/appointments'
import { getFormations, updateFormation } from '../api/formations'
import { getInterventions, updateIntervention } from '../api/interventions'
import { getInstallations } from '../api/installations'
import { getUsers } from '../api/users'
import EventModal from '../components/EventModal'
import FormationModal from '../components/FormationModal'
import ControlCreateModal from '../components/ControlCreateModal'
import ScheduleControlModal from '../components/ScheduleControlModal'
import { isToSchedule } from '../lib/scheduledControls'
import { AttenteListModal } from '../components/ControlAdminModals'
import AppointmentViewModal from '../components/AppointmentViewModal'
import { useAuth } from '../context/AuthContext'
import {
  TYPE_OPTS, STATUS_OPTS, TYPE_MAP, formatTime, localDateStr,
  DEDICATED_TYPES, CONTROL_TYPES, controlTypeToPlanning, controlEventTitle,
  placeTitle, eventTooltip,
} from '../lib/appointmentConstants'

// Ré-export pour compatibilité (anciens imports depuis cette page).
export { TYPE_OPTS, STATUS_OPTS } from '../lib/appointmentConstants'

const CONTROL_LABELS = {
  semestriel:   'Contrôle semestriel',
  annuel:       'Contrôle annuel',
  hors_contrat: 'Contrôle hors contrat',
  intervention: 'Intervention',
}

/** Délai lisible d'un coup d'œil : « dans 3 j », « dans 5 mois ». */
function relativeDays(date) {
  const target = new Date(date)
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const n = new Date(); n.setHours(0, 0, 0, 0)
  const days = Math.round((t - n) / 86400000)
  if (days <= 0)  return "auj."
  if (days === 1) return 'demain'
  if (days < 31)  return `${days} j`
  const months = Math.round(days / 30)
  return months < 12 ? `${months} mois` : `${Math.round(days / 365)} an${days >= 730 ? 's' : ''}`
}

/**
 * Tous les contrôles restant à faire, du plus proche au plus lointain.
 *
 * Le calendrier n'affiche qu'une période à la fois ; cette liste donne la suite
 * complète, sans horizon. Elle vit dans une modale pour ne pas encombrer la
 * colonne de gauche.
 */
function UpcomingControlsModal({ items, onClose, onOpen }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title">
            <CalendarClock size={16} /> Prochains contrôles ({items.length})
          </h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {items.length === 0 ? (
            <p className="plan-side-empty" style={{ padding: '24px 0', textAlign: 'center' }}>
              Aucun contrôle planifié.
            </p>
          ) : (
            <ul className="plan-next-list plan-next-list--modal">
              {items.map(iv => {
                const d = new Date(iv.scheduledDate)
                return (
                  <li key={iv._id} className="plan-next-item" onClick={() => onOpen(iv._id)}>
                    <span className="plan-next-date">
                      <span className="plan-next-day">
                        {d.toLocaleDateString('fr-FR', { day: '2-digit' })}
                      </span>
                      <span className="plan-next-month">
                        {d.toLocaleDateString('fr-FR', { month: 'short' })}
                      </span>
                      <span className="plan-next-year">{d.getFullYear()}</span>
                    </span>
                    <span className="plan-next-main">
                      <span className="plan-next-title">{iv.clientName || 'Client'}</span>
                      <span className="plan-next-sub">
                        {CONTROL_LABELS[iv.controlType] || 'Contrôle'}
                        {iv.siteName ? ` · ${iv.siteName}` : ''}
                      </span>
                    </span>
                    <span className="plan-next-in">{relativeDays(iv.scheduledDate)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn--primary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

/* ── Helpers événements ─────────────────────────────────────── */

function toFCEvent(a) {
  const tc = TYPE_MAP[a.type] || TYPE_MAP.autre
  return {
    id:              a._id,
    title:           placeTitle(a.clientName) || a.title,
    start:           a.start,
    end:             a.end || undefined,
    allDay:          a.allDay,
    backgroundColor: tc.color,
    borderColor:     tc.color,
    textColor:       '#fff',
    extendedProps:   {
      kind: 'appointment', type: a.type, status: a.status,
      place: { client: a.clientName || a.title },
      tooltip: eventTooltip(a.type, a.title),
      description: a.description, _raw: a,
    },
  }
}

// Un contrôle (intervention, collection séparée) en lecture seule. Son type de
// planning distingue semestriel, annuel et hors contrat.
// Un contrôle à venir se déplace au glisser-déposer (date réelle) ; sa durée,
// elle, n'a pas de sens dans le planning.
function toInterventionEvent(iv, canMove) {
  const type  = controlTypeToPlanning(iv.controlType)
  const color = TYPE_MAP[type].color
  const start = new Date(iv.scheduledDate)
  const toSchedule = isToSchedule(iv)
  return {
    id:              `intv-${iv._id}`,
    title:           controlEventTitle(iv),
    start,
    end:             new Date(start.getTime() + 60 * 60000),
    // Échéance théorique : fond clair, texte et pointillé de la couleur du type.
    backgroundColor: toSchedule ? '#fff' : color,
    borderColor:     color,
    textColor:       toSchedule ? color : '#fff',
    startEditable:   canMove && iv.status !== 'termine',
    durationEditable: false,
    extendedProps:   {
      kind: 'intervention', type, status: iv.status, toSchedule, _intv: iv,
      place:   { client: iv.clientName, site: iv.siteName || iv.site?.name },
      tooltip: eventTooltip(type, iv.objet),
    },
  }
}

// Une pose d'installation « à installer » en lecture seule.
function toInstallationEvent(inst) {
  const color = TYPE_MAP.installation.color
  const start = new Date(inst.scheduledDate)
  return {
    id:              `inst-${inst._id}`,
    title:           placeTitle(inst.clientName, inst.site?.name) || 'Installation',
    start,
    end:             new Date(start.getTime() + 60 * 60000),
    backgroundColor: color,
    borderColor:     color,
    textColor:       '#fff',
    editable:        false,
    extendedProps:   {
      kind: 'installation', type: 'installation', status: inst.status, _inst: inst,
      place:   { client: inst.clientName, site: inst.site?.name },
      tooltip: eventTooltip('installation', [inst.deviceType, inst.serialNumber].filter(Boolean).join(' · ')),
    },
  }
}

// Une formation (collection Formation, source de vérité) — éditable dans le planning.
function toFormationEvent(f) {
  const color = TYPE_MAP.formation.color
  const start = new Date(f.date)
  const end   = f.end ? new Date(f.end) : new Date(start.getTime() + 60 * 60000)
  return {
    id:              f._id,
    title:           placeTitle(f.clientName, f.site?.name || f.siteName) || f.title,
    start,
    end,
    backgroundColor: color,
    borderColor:     color,
    textColor:       '#fff',
    editable:        true,
    extendedProps:   {
      kind: 'formation', type: 'formation', status: f.status, _raw: f,
      place:   { client: f.clientName || f.title, site: f.site?.name || f.siteName },
      tooltip: eventTooltip('formation', f.title),
    },
  }
}

function todayRange() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString()
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  return { start, end }
}

/* ── Main page ──────────────────────────────────────────────── */

export default function PlanningPage() {
  const navigate = useNavigate()
  const calendarRef = useRef(null)
  const [modal,       setModal]       = useState(null)
  // Les formations ont leur fiche dédiée (agents, attestations, documents) :
  // elles ne passent pas par la modal de rendez-vous.
  const [fmnModal,    setFmnModal]    = useState(null)
  // Un contrôle se crée avec la même fiche que depuis la page Contrôles.
  const [ctrlModal,   setCtrlModal]   = useState(null)
  // Caler un contrôle déjà prévu par le contrat (date réelle, technicien).
  const [schedModal,  setSchedModal]  = useState(null)
  /* Contrôles en attente de RDV : hors calendrier, listés à part. `?attente=1`
     (alerte du tableau de bord) ouvre directement la liste. */
  const [params, setParams] = useSearchParams()
  const [attenteOpen,  setAttenteOpen]  = useState(params.get('attente') === '1')
  const [attenteCount, setAttenteCount] = useState(0)
  const [attenteKey,   setAttenteKey]   = useState(0)
  const [viewing,     setViewing]     = useState(null)   // RDV consulté sans droit d'édition
  const [todayEvents, setTodayEvents] = useState([])
  const [upcoming,     setUpcoming]     = useState([])   // contrôles à venir, tous horizons
  const [upcomingOpen, setUpcomingOpen] = useState(false)
  const [typeFilter,  setTypeFilter]  = useState(null)
  const [users,       setUsers]       = useState([])

  /* Le technicien lit le planning, il ne l'écrit pas : le serveur refuse ses
     écritures, l'interface ne les propose donc pas. */
  const { user } = useAuth()
  const readOnlyPlanning = user?.role === 'technicien'

  useEffect(() => {
    getUsers().then(data => setUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  const fetchToday = useCallback(() => {
    const { start, end } = todayRange()
    Promise.all([
      getAppointments({ start, end }).catch(() => []),
      getInterventions({ from: start, to: end }).catch(() => []),
      getInstallations({ status: 'a_installer', from: start, to: end }).catch(() => ({ data: [] })),
      getFormations({ from: start, to: end }).catch(() => []),
    ]).then(([appts, intvs, instRes, fmns]) => {
      const insts = Array.isArray(instRes) ? instRes : (instRes?.data || [])
      const items = [
        ...(Array.isArray(appts) ? appts : []).map(a => ({
          ...a, _kind: 'appointment', _raw: a, title: placeTitle(a.clientName) || a.title,
        })),
        ...(Array.isArray(intvs) ? intvs : []).filter(i => i.scheduledDate).map(i => ({
          _id: i._id, _kind: 'intervention',
          title: controlEventTitle(i),
          start: i.scheduledDate, type: controlTypeToPlanning(i.controlType),
          clientName: i.clientName, status: i.status,
        })),
        ...insts.filter(i => i.scheduledDate).map(i => ({
          _id: i._id, _kind: 'installation',
          title: placeTitle(i.clientName, i.site?.name) || 'Installation',
          start: i.scheduledDate, type: 'installation',
          clientName: i.clientName, status: i.status,
        })),
        ...(Array.isArray(fmns) ? fmns : []).map(f => ({
          _id: f._id, _kind: 'formation',
          title: placeTitle(f.clientName, f.site?.name || f.siteName) || f.title,
          start: f.date, end: f.end, type: 'formation',
          clientName: f.clientName, status: f.status, _raw: f,
        })),
      ].sort((a, b) => new Date(a.start) - new Date(b.start))
      setTodayEvents(items)
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchToday() }, [fetchToday])

  /* Tous les contrôles encore à faire, sans horizon : le calendrier montre un
     mois à la fois, cette liste donne la suite — y compris les échéances les
     plus lointaines — dans l'ordre où elles tomberont. */
  const fetchUpcoming = useCallback(() => {
    getInterventions()
      .then(data => {
        const now = new Date(); now.setHours(0, 0, 0, 0)
        const list = Array.isArray(data) ? data : []
        setAttenteCount(list.filter(i => i.enAttente && i.status !== 'termine').length)
        setUpcoming(
          list
            .filter(i => i.status !== 'termine' && i.scheduledDate && !i.enAttente
              && new Date(i.scheduledDate) >= now)
            .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
        )
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchUpcoming() }, [fetchUpcoming])

  function refetch() {
    calendarRef.current?.getApi().refetchEvents()
    fetchToday()
  }

  const loadEvents = useCallback((info, success, fail) => {
    // Sources : RDV (appointments), contrôles (interventions), poses (installations
    // à installer), formations. Un filtre par type ne montre que la source correspondante.
    const wantAppt = !typeFilter || !DEDICATED_TYPES.includes(typeFilter)
    const wantIntv = !typeFilter || CONTROL_TYPES.includes(typeFilter)
    const wantInst = !typeFilter || typeFilter === 'installation'
    const wantFmn  = !typeFilter || typeFilter === 'formation'

    const apptP = wantAppt
      ? getAppointments({
          start: info.startStr, end: info.endStr,
          ...(typeFilter && !DEDICATED_TYPES.includes(typeFilter) ? { type: typeFilter } : {}),
        }).catch(() => [])
      : Promise.resolve([])
    const intvP = wantIntv
      ? getInterventions({ from: info.startStr, to: info.endStr }).catch(() => [])
      : Promise.resolve([])
    const instP = wantInst
      ? getInstallations({ status: 'a_installer', from: info.startStr, to: info.endStr }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] })
    const fmnP = wantFmn
      ? getFormations({ from: info.startStr, to: info.endStr }).catch(() => [])
      : Promise.resolve([])

    Promise.all([apptP, intvP, instP, fmnP])
      .then(([appts, intvs, instRes, fmns]) => {
        const insts = Array.isArray(instRes) ? instRes : (instRes?.data || [])
        // Les contrôles arrivent d'une seule requête : le tri semestriel /
        // annuel / hors contrat se fait ici.
        const keepIntv = i => i.scheduledDate &&
          (!typeFilter || controlTypeToPlanning(i.controlType) === typeFilter)

        success([
          ...(Array.isArray(appts) ? appts : []).map(toFCEvent),
          ...(Array.isArray(intvs) ? intvs : []).filter(keepIntv).map(i => toInterventionEvent(i, !readOnlyPlanning)),
          ...insts.filter(i => i.scheduledDate).map(toInstallationEvent),
          ...(Array.isArray(fmns) ? fmns : []).map(toFormationEvent),
        ])
      })
      .catch(fail)
  }, [typeFilter, readOnlyPlanning])

  function handleSelect(info) {
    // Le technicien ne compose pas le planning : sélectionner un créneau ne
    // doit rien ouvrir.
    if (readOnlyPlanning) { info.view.calendar.unselect(); return }
    setModal({ mode: 'create', slot: info })
    info.view.calendar.unselect()
  }

  function handleEventClick(info) {
    const ep = info.event.extendedProps
    // Un contrôle reste ouvrable : c'est le travail du technicien.
    if (ep.kind === 'intervention')  { navigate(`/interventions/${ep._intv._id}`); return }
    if (ep.kind === 'installation')  { navigate(`/devices/${ep._inst._id}`); return }
    if (readOnlyPlanning) { setViewing(ep._raw); return }
    if (ep.kind === 'formation')     { setFmnModal({ mode: 'edit', formation: ep._raw }); return }
    setModal({ mode: 'edit', entityKind: 'appointment', entity: ep._raw })
  }

  async function handleEventDrop(info) {
    const ep = info.event.extendedProps
    const id = ep._raw?._id || info.event.id
    try {
      if (ep.kind === 'intervention') {
        // Déplacer un contrôle, c'est lui donner sa date réelle.
        await updateIntervention(ep._intv._id, { scheduledDate: info.event.start.toISOString() })
        toast.success(`Contrôle déplacé au ${info.event.start.toLocaleDateString('fr-FR')}.`)
        refetch()
        fetchUpcoming()
        return
      }
      if (ep.kind === 'formation') {
        await updateFormation(id, { date: info.event.startStr, end: info.event.endStr || undefined })
      } else {
        await updateAppointment(id, {
          start:  info.event.startStr,
          end:    info.event.endStr || undefined,
          allDay: info.event.allDay,
        })
      }
      fetchToday()
    } catch {
      info.revert()
      toast.error('Impossible de déplacer l\'événement.')
    }
  }

  async function handleEventResize(info) {
    const ep = info.event.extendedProps
    const id = ep._raw?._id || info.event.id
    try {
      if (ep.kind === 'formation') {
        await updateFormation(id, { date: info.event.startStr, end: info.event.endStr })
      } else {
        await updateAppointment(id, { start: info.event.startStr, end: info.event.endStr })
      }
    } catch {
      info.revert()
      toast.error('Impossible de redimensionner.')
    }
  }

  function handleTodayClick(e) {
    if (e._kind === 'intervention') { navigate(`/interventions/${e._id}`); return }
    if (e._kind === 'installation') { navigate(`/devices/${e._id}`); return }
    if (readOnlyPlanning) { setViewing(e._raw); return }
    if (e._kind === 'formation')    { setFmnModal({ mode: 'edit', formation: e._raw }); return }
    setModal({ mode: 'edit', entityKind: 'appointment', entity: e._raw })
  }

  return (
    <div className="plan-page">

      {/* ── Left sidebar ─────────────────────────── */}
      <aside className="plan-side">

        {!readOnlyPlanning && (
          <div className="plan-side-section">
            <button className="btn btn--primary plan-add-btn" style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setModal({ mode: 'create', slot: null })}>
              <Plus size={14} /> Nouveau RDV
            </button>
            {/* Une formation se programme aussi souvent qu'un rendez-vous :
                elle mérite son entrée directe. */}
            <button className="btn btn--ghost plan-add-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              onClick={() => setFmnModal({ mode: 'create', slot: null })}>
              <GraduationCap size={14} /> Nouvelle formation
            </button>
            <button className="btn btn--ghost plan-add-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              onClick={() => setSchedModal({ date: null })}>
              <Wrench size={14} /> Programmer un contrôle
            </button>
            <button className="btn btn--ghost plan-add-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              onClick={() => setCtrlModal({ date: null, kind: 'intervention' })}>
              <Hammer size={14} /> Nouvelle intervention
            </button>
            {/* La semaine affichée dans le calendrier (ou la semaine en cours). */}
            <button className="btn btn--ghost plan-add-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              onClick={() => {
                const d = calendarRef.current?.getApi().getDate() || new Date()
                window.open(`/interventions/bons?semaine=${localDateStr(d)}`, '_blank')
              }}>
              <Printer size={14} /> Bons de la semaine
            </button>
          </div>
        )}

        <div className="plan-side-section">
          <h3 className="plan-side-title">Aujourd'hui</h3>
          {todayEvents.length === 0 ? (
            <p className="plan-side-empty">Aucun rendez-vous</p>
          ) : (
            <ul className="plan-today-list">
              {todayEvents.map(e => (
                <li key={`${e._kind}-${e._id}`} className="plan-today-item"
                  onClick={() => handleTodayClick(e)}>
                  <span className="plan-today-dot"
                    style={{ background: TYPE_MAP[e.type]?.color || '#6b7280' }} />
                  <div>
                    <div className="plan-today-title">
                      {e._kind === 'intervention' && <Wrench size={11} style={{ verticalAlign: -1, marginRight: 4 }} />}
                      {e._kind === 'installation' && <Zap size={11} style={{ verticalAlign: -1, marginRight: 4 }} />}
                      {e.title}
                    </div>
                    {!e.allDay && (
                      <div className="plan-today-time">
                        {formatTime(e.start)}{e.end ? ` → ${formatTime(e.end)}` : ''}
                      </div>
                    )}
                    {e.clientName && <div className="plan-today-time">{e.clientName}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* La liste complète encombrait la colonne : elle passe derrière un
            bouton qui l'ouvre en modale. */}
        <div className="plan-side-section">
          <button type="button" className="btn btn--ghost plan-ctrl-btn"
            onClick={() => setUpcomingOpen(true)}>
            <CalendarClock size={14} /> Prochains contrôles
            <span className="plan-ctrl-count">{upcoming.length}</span>
          </button>
          {/* Contrôles dus que le client n'a pas encore voulu caler. */}
          <button type="button" className="btn btn--ghost plan-ctrl-btn" style={{ marginTop: 6 }}
            onClick={() => setAttenteOpen(true)}>
            <PauseCircle size={14} /> En attente de planification
            <span className={`plan-ctrl-count${attenteCount ? ' plan-ctrl-count--wait' : ''}`}>{attenteCount}</span>
          </button>
        </div>

        <div className="plan-side-section">
          <h3 className="plan-side-title">Filtrer par type</h3>
          <div className="plan-type-list">
            <button
              className={`plan-type-btn${typeFilter === null ? ' plan-type-btn--all' : ''}`}
              onClick={() => setTypeFilter(null)}>
              Tous les types
            </button>
            {TYPE_OPTS.map(t => (
              <button key={t.value}
                className={`plan-type-btn${typeFilter === t.value ? ' plan-type-btn--active' : ''}`}
                style={typeFilter === t.value
                  ? { background: t.color + '20', borderColor: t.color, color: t.color }
                  : {}}
                onClick={() => setTypeFilter(prev => prev === t.value ? null : t.value)}>
                <span className="plan-type-dot" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="plan-side-section">
          <h3 className="plan-side-title">Légende statuts</h3>
          <div className="plan-status-list">
            {STATUS_OPTS.map(s => (
              <div key={s.value} className="plan-status-item">
                <span className="plan-status-dot" style={{ background: s.color }} />
                {s.label}
              </div>
            ))}
            {/* Contrôle du contrat pas encore calé : à glisser sur sa vraie date. */}
            <div className="plan-status-item" title="Contrôle du contrat sans technicien assigné — glissez-le sur le bon jour, ou programmez-le">
              <span className="plan-status-dot plan-status-dot--dashed" />
              Sans technicien
            </div>
          </div>
        </div>

      </aside>

      {/* ── Calendar ─────────────────────────────── */}
      <div className="plan-cal-wrap">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          locale={frLocale}
          initialView="dayGridMonth"
          headerToolbar={{
            left:   'prev,next today',
            center: 'title',
            right:  'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          buttonText={{
            today: "Auj.",
            month: 'Mois',
            week:  'Sem.',
            day:   'Jour',
            list:  'Liste',
          }}
          editable={!readOnlyPlanning}
          selectable={!readOnlyPlanning}
          selectMirror
          dayMaxEvents={4}
          eventDisplay="block"
          displayEventTime={false}
          nowIndicator
          events={loadEvents}
          select={handleSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          height="100%"
          eventClassNames={info => {
            const status = info.event.extendedProps.status
            const cls = []
            if (status === 'fait' || status === 'termine') cls.push('fc-event--fait')
            if (status === 'annule') cls.push('fc-event--annule')
            if (info.event.extendedProps.toSchedule) cls.push('fc-event--a-programmer')
            return cls
          }}
          eventContent={info => {
            /* Le client, puis le site : la couleur dit déjà de quoi il s'agit
               (contrôle, intervention, formation…), l'infobulle le précise. */
            const { place = {} } = info.event.extendedProps
            const client = place.client || info.event.title
            const site   = place.site && place.site.toLowerCase() !== String(client).toLowerCase() ? place.site : ''
            return (
              <div className="plan-event-inner">
                <span className="plan-event-title">{client}</span>
                {site && <span className="plan-event-client">{site}</span>}
              </div>
            )
          }}
          eventDidMount={info => {
            const tip = info.event.extendedProps.tooltip
            if (tip) info.el.title = `${tip}\n${info.event.title}`
          }}
        />
      </div>

      {/* ── Modal ────────────────────────────────── */}
      {modal && (
        <EventModal
          mode={modal.mode}
          entity={modal.entity}
          entityKind={modal.entityKind}
          slot={modal.slot}
          users={users}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refetch() }}
          onDeleted={() => { setModal(null); refetch() }}
          onChanged={() => refetch()}
          // Le créneau retenu suit : choisir « Formation » dans la modal de RDV
          // ouvre la fiche formation sur la même case du calendrier.
          onSwitchToFormation={slot => { setModal(null); setFmnModal({ mode: 'create', slot }) }}
          onSwitchToControl={(slot, opts = {}) => {
            setModal(null)
            setCtrlModal({ date: slot?.startStr || null, kind: opts.kind, objet: opts.objet })
          }}
          onSwitchToScheduled={(slot, type, title) => {
            setModal(null)
            setSchedModal({ date: slot?.startStr || null, type, title })
          }}
        />
      )}

      {attenteOpen && (
        <AttenteListModal
          refreshKey={attenteKey}
          onClose={() => {
            setAttenteOpen(false)
            if (params.get('attente')) { params.delete('attente'); setParams(params, { replace: true }) }
          }}
          onOpen={id => navigate(`/interventions/${id}`)}
          onSchedule={readOnlyPlanning ? null : iv => setSchedModal({ date: null, control: iv })}
        />
      )}

      {schedModal && (
        <ScheduleControlModal
          presetDate={schedModal.date}
          presetType={schedModal.type}
          presetControl={schedModal.control}
          presetTitle={schedModal.title}
          onClose={() => setSchedModal(null)}
          onDone={() => { setSchedModal(null); refetch(); fetchUpcoming(); setAttenteKey(k => k + 1) }}
          onHorsContrat={date => { setSchedModal(null); setCtrlModal({ date }) }}
        />
      )}

      {ctrlModal && (
        <ControlCreateModal
          kind={ctrlModal.kind}
          presetDate={ctrlModal.date}
          presetObjet={ctrlModal.objet}
          onClose={() => setCtrlModal(null)}
          onCreated={() => { setCtrlModal(null); refetch(); fetchUpcoming() }}
        />
      )}

      {fmnModal && (
        <FormationModal
          mode={fmnModal.mode}
          formation={fmnModal.formation}
          slot={fmnModal.slot}
          users={users}
          onClose={() => setFmnModal(null)}
          onSaved={() => { setFmnModal(null); refetch() }}
          onDeleted={() => { setFmnModal(null); refetch() }}
          onChanged={() => refetch()}
        />
      )}

      {viewing && (
        <AppointmentViewModal appointment={viewing} onClose={() => setViewing(null)} />
      )}

      {upcomingOpen && (
        <UpcomingControlsModal
          items={upcoming}
          onClose={() => setUpcomingOpen(false)}
          onOpen={id => { setUpcomingOpen(false); navigate(`/interventions/${id}`) }}
        />
      )}
    </div>
  )
}
