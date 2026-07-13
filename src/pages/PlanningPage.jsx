import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin   from '@fullcalendar/daygrid'
import timeGridPlugin  from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin      from '@fullcalendar/list'
import frLocale        from '@fullcalendar/core/locales/fr'
import { Plus, Wrench, Zap } from 'lucide-react'
import { toast } from 'react-toastify'
import { getAppointments, updateAppointment } from '../api/appointments'
import { getFormations, updateFormation } from '../api/formations'
import { getInterventions } from '../api/interventions'
import { getInstallations } from '../api/installations'
import { getUsers } from '../api/users'
import EventModal from '../components/EventModal'
import { TYPE_OPTS, STATUS_OPTS, TYPE_MAP, formatTime } from '../lib/appointmentConstants'

// Ré-export pour compatibilité (anciens imports depuis cette page).
export { TYPE_OPTS, STATUS_OPTS } from '../lib/appointmentConstants'

/* ── Helpers événements ─────────────────────────────────────── */

function toFCEvent(a) {
  const tc = TYPE_MAP[a.type] || TYPE_MAP.autre
  return {
    id:              a._id,
    title:           a.title,
    start:           a.start,
    end:             a.end || undefined,
    allDay:          a.allDay,
    backgroundColor: tc.color,
    borderColor:     tc.color,
    textColor:       '#fff',
    extendedProps:   { kind: 'appointment', type: a.type, status: a.status, clientName: a.clientName, description: a.description, _raw: a },
  }
}

// Un contrôle (intervention, collection séparée) en lecture seule.
function toInterventionEvent(iv) {
  const color = TYPE_MAP.intervention.color
  const start = new Date(iv.scheduledDate)
  return {
    id:              `intv-${iv._id}`,
    title:           `Contrôle${iv.clientName ? ' — ' + iv.clientName : ''}`,
    start,
    end:             new Date(start.getTime() + 60 * 60000),
    backgroundColor: color,
    borderColor:     color,
    textColor:       '#fff',
    editable:        false,
    extendedProps:   { kind: 'intervention', type: 'intervention', status: iv.status, clientName: iv.clientName, _intv: iv },
  }
}

// Une pose d'installation « à installer » en lecture seule.
function toInstallationEvent(inst) {
  const color = TYPE_MAP.installation.color
  const start = new Date(inst.scheduledDate)
  return {
    id:              `inst-${inst._id}`,
    title:           `Installation${inst.clientName ? ' — ' + inst.clientName : ''}`,
    start,
    end:             new Date(start.getTime() + 60 * 60000),
    backgroundColor: color,
    borderColor:     color,
    textColor:       '#fff',
    editable:        false,
    extendedProps:   { kind: 'installation', type: 'installation', status: inst.status, clientName: inst.clientName, _inst: inst },
  }
}

// Une formation (collection Formation, source de vérité) — éditable dans le planning.
function toFormationEvent(f) {
  const color = TYPE_MAP.formation.color
  const start = new Date(f.date)
  const end   = f.end ? new Date(f.end) : new Date(start.getTime() + 60 * 60000)
  return {
    id:              f._id,
    title:           f.title,
    start,
    end,
    backgroundColor: color,
    borderColor:     color,
    textColor:       '#fff',
    editable:        true,
    extendedProps:   { kind: 'formation', type: 'formation', status: f.status, clientName: f.clientName, _raw: f },
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
  const [todayEvents, setTodayEvents] = useState([])
  const [typeFilter,  setTypeFilter]  = useState(null)
  const [users,       setUsers]       = useState([])

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
        ...(Array.isArray(appts) ? appts : []).map(a => ({ ...a, _kind: 'appointment', _raw: a })),
        ...(Array.isArray(intvs) ? intvs : []).filter(i => i.scheduledDate).map(i => ({
          _id: i._id, _kind: 'intervention',
          title: `Contrôle${i.clientName ? ' — ' + i.clientName : ''}`,
          start: i.scheduledDate, type: 'intervention',
          clientName: i.clientName, status: i.status,
        })),
        ...insts.filter(i => i.scheduledDate).map(i => ({
          _id: i._id, _kind: 'installation',
          title: `Installation${i.clientName ? ' — ' + i.clientName : ''}`,
          start: i.scheduledDate, type: 'installation',
          clientName: i.clientName, status: i.status,
        })),
        ...(Array.isArray(fmns) ? fmns : []).map(f => ({
          _id: f._id, _kind: 'formation',
          title: f.title, start: f.date, end: f.end, type: 'formation',
          clientName: f.clientName, status: f.status, _raw: f,
        })),
      ].sort((a, b) => new Date(a.start) - new Date(b.start))
      setTodayEvents(items)
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchToday() }, [fetchToday])

  function refetch() {
    calendarRef.current?.getApi().refetchEvents()
    fetchToday()
  }

  const loadEvents = useCallback((info, success, fail) => {
    // Sources : RDV (appointments), contrôles (interventions), poses (installations
    // à installer), formations. Un filtre par type ne montre que la source correspondante.
    const wantAppt = !typeFilter || !['intervention', 'installation', 'formation'].includes(typeFilter)
    const wantIntv = !typeFilter || typeFilter === 'intervention'
    const wantInst = !typeFilter || typeFilter === 'installation'
    const wantFmn  = !typeFilter || typeFilter === 'formation'

    const apptP = wantAppt
      ? getAppointments({
          start: info.startStr, end: info.endStr,
          ...(typeFilter && !['intervention', 'installation', 'formation'].includes(typeFilter) ? { type: typeFilter } : {}),
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
        success([
          ...(Array.isArray(appts) ? appts : []).map(toFCEvent),
          ...(Array.isArray(intvs) ? intvs : []).filter(i => i.scheduledDate).map(toInterventionEvent),
          ...insts.filter(i => i.scheduledDate).map(toInstallationEvent),
          ...(Array.isArray(fmns) ? fmns : []).map(toFormationEvent),
        ])
      })
      .catch(fail)
  }, [typeFilter])

  function handleSelect(info) {
    setModal({ mode: 'create', slot: info })
    info.view.calendar.unselect()
  }

  function handleEventClick(info) {
    const ep = info.event.extendedProps
    if (ep.kind === 'intervention')  { navigate(`/interventions/${ep._intv._id}`); return }
    if (ep.kind === 'installation')  { navigate(`/devices/${ep._inst._id}`); return }
    if (ep.kind === 'formation')     { setModal({ mode: 'edit', entityKind: 'formation', entity: ep._raw }); return }
    setModal({ mode: 'edit', entityKind: 'appointment', entity: ep._raw })
  }

  async function handleEventDrop(info) {
    const ep = info.event.extendedProps
    const id = ep._raw?._id || info.event.id
    try {
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
    if (e._kind === 'formation')    { setModal({ mode: 'edit', entityKind: 'formation', entity: e._raw }); return }
    setModal({ mode: 'edit', entityKind: 'appointment', entity: e._raw })
  }

  return (
    <div className="plan-page">

      {/* ── Left sidebar ─────────────────────────── */}
      <aside className="plan-side">

        <div className="plan-side-section">
          <button className="btn btn--primary plan-add-btn" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setModal({ mode: 'create', slot: null })}>
            <Plus size={14} /> Nouveau RDV
          </button>
        </div>

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
          editable
          selectable
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
            return cls
          }}
          eventContent={info => (
            <div className="plan-event-inner">
              <span className="plan-event-title">{info.event.title}</span>
              {info.event.extendedProps.clientName && (
                <span className="plan-event-client">{info.event.extendedProps.clientName}</span>
              )}
            </div>
          )}
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
        />
      )}
    </div>
  )
}
