import { useState, useEffect, useCallback, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin   from '@fullcalendar/daygrid'
import timeGridPlugin  from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin      from '@fullcalendar/list'
import frLocale        from '@fullcalendar/core/locales/fr'
import { Calendar, Plus, X, AlertTriangle, Trash2, Search, Check, ChevronDown, Users } from 'lucide-react'
import { toast } from 'react-toastify'
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
} from '../api/appointments'
import { getClients } from '../api/clients'
import { getUsers }   from '../api/users'

/* ── Constants ─────────────────────────────────────────────── */

const ROLE_LABELS = {
  superadmin: 'Super admin', admin: 'Admin', technicien: 'Technicien',
  commercial: 'Commercial',  assistante: 'Assistante', readonly: 'Lecture seule',
}

const AVATAR_COLORS = ['#f97316','#3b82f6','#22c55e','#a855f7','#ef4444','#14b8a6','#f59e0b','#ec4899']
function avatarColor(str = '') {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

export const TYPE_OPTS = [
  { value: 'controle',      label: 'Contrôle',      color: '#f97316' },
  { value: 'intervention',  label: 'Intervention',  color: '#ef4444' },
  { value: 'installation',  label: 'Installation',  color: '#22c55e' },
  { value: 'formation',     label: 'Formation',     color: '#a855f7' },
  { value: 'reunion',       label: 'Réunion',       color: '#3b82f6' },
  { value: 'autre',         label: 'Autre',         color: '#6b7280' },
]

export const STATUS_OPTS = [
  { value: 'planifie',  label: 'Planifié',  color: '#6b7280' },
  { value: 'en_cours',  label: 'En cours',  color: '#f97316' },
  { value: 'fait',      label: 'Fait',      color: '#22c55e' },
  { value: 'annule',    label: 'Annulé',    color: '#ef4444' },
]

const TYPE_MAP   = Object.fromEntries(TYPE_OPTS.map(t => [t.value, t]))
const STATUS_MAP = Object.fromEntries(STATUS_OPTS.map(s => [s.value, s]))

/* ── Helpers ────────────────────────────────────────────────── */

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
    extendedProps:   { type: a.type, status: a.status, clientName: a.clientName, description: a.description, _raw: a },
  }
}

function toLocalInput(isoStr) {
  if (!isoStr) return ''
  const d   = new Date(isoStr)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toDateInput(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toISOString().split('T')[0]
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function todayRange() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString()
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  return { start, end }
}

/* ── Client search autocomplete ─────────────────────────────── */

function ClientSearchInput({ clientId, clientName, onChange }) {
  const [query,   setQuery]   = useState(clientName || '')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapRef  = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    if (clientId) onChange(null)          // unselect on retype
    setOpen(true)
    clearTimeout(timerRef.current)
    if (!q.trim()) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await getClients({ q, limit: 8 })
        setResults(data.data || [])
      } catch { setResults([]) }
      finally  { setLoading(false) }
    }, 280)
  }

  function handleSelect(c) {
    onChange({ id: c._id, name: c.name })
    setQuery(c.name)
    setOpen(false)
    setResults([])
  }

  function handleClear() {
    onChange(null)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="plan-client-wrap" ref={wrapRef}>
      <div className="plan-client-field">
        <Search size={13} className="plan-client-ico" />
        <input
          className="plan-client-input"
          value={query}
          onChange={handleChange}
          onFocus={() => { if (query.trim() && !clientId) setOpen(true) }}
          placeholder="Rechercher un client…"
          autoComplete="off"
        />
        {(clientId || query) && (
          <button type="button" className="plan-client-clear" onClick={handleClear}>
            <X size={12} />
          </button>
        )}
      </div>
      {clientId && (
        <div className="plan-client-badge">
          <span>{query}</span>
        </div>
      )}
      {open && (
        <div className="plan-client-dropdown">
          {loading && <div className="plan-client-msg">Recherche…</div>}
          {!loading && results.length === 0 && query.trim() && (
            <div className="plan-client-msg">Aucun résultat</div>
          )}
          {results.map(c => (
            <button key={c._id} type="button" className="plan-client-option"
              onClick={() => handleSelect(c)}>
              <span className="plan-client-opt-name">{c.name}</span>
              {c.address?.city && <span className="plan-client-opt-sub">{c.address.city}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Assigned-to multi-select ───────────────────────────────── */

function AssignedToInput({ selected, onChange, users }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function toggle(user) {
    const already = selected.some(s => s._id === user._id)
    onChange(already
      ? selected.filter(s => s._id !== user._id)
      : [...selected, { _id: user._id, fullName: user.fullName }]
    )
  }

  function remove(id, e) {
    e.stopPropagation()
    onChange(selected.filter(s => s._id !== id))
  }

  return (
    <div className="plan-assign-wrap" ref={wrapRef}>
      <div className={`plan-assign-field${open ? ' plan-assign-field--open' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0 ? (
          <span className="plan-assign-placeholder">Assigner des personnes…</span>
        ) : (
          <div className="plan-assign-chips">
            {selected.map(u => (
              <span key={u._id} className="plan-assign-chip"
                style={{ background: avatarColor(u.fullName) }}>
                {initials(u.fullName)}
                <button type="button" className="plan-assign-chip-rm"
                  onClick={e => remove(u._id, e)}><X size={9} /></button>
              </span>
            ))}
          </div>
        )}
        <ChevronDown size={13}
          className={`plan-assign-chevron${open ? ' plan-assign-chevron--open' : ''}`} />
      </div>

      {open && (
        <div className="plan-assign-dropdown">
          {users.length === 0 && (
            <div className="plan-client-msg">Aucun utilisateur disponible</div>
          )}
          {users.map(u => {
            const isOn = selected.some(s => s._id === u._id)
            return (
              <button key={u._id} type="button"
                className={`plan-assign-option${isOn ? ' plan-assign-option--on' : ''}`}
                onClick={() => toggle(u)}>
                <span className="plan-assign-check">{isOn && <Check size={11} />}</span>
                <span className="plan-assign-av" style={{ background: avatarColor(u.fullName) }}>
                  {initials(u.fullName)}
                </span>
                <div className="plan-assign-info">
                  <span className="plan-assign-name">{u.fullName}</span>
                  <span className="plan-assign-role">{ROLE_LABELS[u.role] || u.role}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Appointment modal ──────────────────────────────────────── */

function AppointmentModal({ mode, slot, appt, onClose, onSaved, onDeleted, users = [] }) {
  const isEdit = mode === 'edit'
  const raw    = appt || {}

  const initStart = () => {
    if (isEdit && raw.start) return raw.allDay ? toDateInput(raw.start) : toLocalInput(raw.start)
    if (slot?.startStr)      return slot.allDay ? slot.startStr.split('T')[0] : toLocalInput(slot.startStr)
    return toLocalInput(new Date().toISOString())
  }
  const initEnd = () => {
    if (isEdit && raw.end) return raw.allDay ? toDateInput(raw.end) : toLocalInput(raw.end)
    if (slot?.endStr)      return slot.allDay ? slot.endStr.split('T')[0] : toLocalInput(slot.endStr)
    return ''
  }

  const [form, setForm] = useState({
    title:       isEdit ? raw.title       : '',
    type:        isEdit ? raw.type        : 'autre',
    status:      isEdit ? raw.status      : 'planifie',
    allDay:      isEdit ? !!raw.allDay    : !!(slot?.allDay),
    start:       initStart(),
    end:         initEnd(),
    clientId:    isEdit ? (raw.client?._id || raw.client || null) : null,
    clientName:  isEdit ? (raw.clientName  || raw.client?.name || '') : '',
    assignedTo:  isEdit
      ? (raw.assignedTo || []).map(id => {
          const sid = typeof id === 'string' ? id : id?._id || String(id)
          return users.find(u => u._id === sid)
        }).filter(Boolean)
      : [],
    description: isEdit ? (raw.description || '') : '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleAllDayToggle(checked) {
    set('allDay', checked)
    if (checked) {
      // convert datetime to date
      setForm(f => ({
        ...f,
        allDay: true,
        start: f.start ? f.start.split('T')[0] : '',
        end:   f.end   ? f.end.split('T')[0]   : '',
      }))
    } else {
      setForm(f => ({
        ...f,
        allDay: false,
        start: f.start ? f.start + 'T08:00' : toLocalInput(new Date().toISOString()),
        end:   f.end   ? f.end   + 'T09:00' : '',
      }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Le titre est requis.')
    if (!form.start)        return setError('La date de début est requise.')
    setLoading(true)
    setError('')
    try {
      const payload = {
        title:       form.title.trim(),
        type:        form.type,
        status:      form.status,
        allDay:      form.allDay,
        start:       new Date(form.start).toISOString(),
        end:         form.end ? new Date(form.end).toISOString() : undefined,
        client:      form.clientId                       || undefined,
        clientName:  form.clientName                      || undefined,
        assignedTo:  form.assignedTo.map(u => u._id),
        description: form.description                     || undefined,
      }
      if (isEdit) {
        await updateAppointment(raw._id, payload)
        toast.success('Rendez-vous mis à jour.')
      } else {
        await createAppointment(payload)
        toast.success('Rendez-vous créé.')
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Supprimer ce rendez-vous ?')) return
    try {
      await deleteAppointment(raw._id)
      toast.success('Rendez-vous supprimé.')
      onDeleted()
    } catch (err) {
      toast.error(err.message || 'Erreur.')
    }
  }

  const typeColor = TYPE_MAP[form.type]?.color || '#6b7280'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pmodal-header-icon" style={{ background: typeColor }}>
              <Calendar size={15} color="#fff" />
            </div>
            <h2 className="modal-title">{isEdit ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}</h2>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="form-group">
            <label className="form-label">Titre *</label>
            <input className="form-input form-input--plain" value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="ex. Contrôle DAE — Maison du Sport" required />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-input form-input--plain" value={form.type}
                onChange={e => set('type', e.target.value)}>
                {TYPE_OPTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Statut</label>
              <select className="form-input form-input--plain" value={form.status}
                onChange={e => set('status', e.target.value)}>
                {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <label className="plan-allday-toggle">
            <input type="checkbox" checked={form.allDay}
              onChange={e => handleAllDayToggle(e.target.checked)} />
            <span>Journée entière</span>
          </label>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Début *</label>
              <input className="form-input form-input--plain"
                type={form.allDay ? 'date' : 'datetime-local'}
                value={form.start}
                onChange={e => set('start', e.target.value)}
                required />
            </div>
            <div className="form-group">
              <label className="form-label">Fin</label>
              <input className="form-input form-input--plain"
                type={form.allDay ? 'date' : 'datetime-local'}
                value={form.end}
                onChange={e => set('end', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Client</label>
            <ClientSearchInput
              clientId={form.clientId}
              clientName={form.clientName}
              onChange={sel => setForm(f => ({
                ...f,
                clientId:   sel ? sel.id   : null,
                clientName: sel ? sel.name : '',
              }))}
            />
          </div>

          {users.length > 0 && (
            <div className="form-group">
              <label className="form-label">Intervenants</label>
              <AssignedToInput
                selected={form.assignedTo}
                onChange={v => set('assignedTo', v)}
                users={users}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-input--plain form-textarea"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Informations complémentaires…" rows={3} />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer" style={{ paddingTop: 0 }}>
            {isEdit && (
              <button type="button" className="btn btn--danger-ghost" onClick={handleDelete}>
                <Trash2 size={14} /> Supprimer
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */

export default function PlanningPage() {
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
    getAppointments({ start, end }).then(setTodayEvents).catch(() => {})
  }, [])

  useEffect(() => { fetchToday() }, [fetchToday])

  function refetch() {
    calendarRef.current?.getApi().refetchEvents()
    fetchToday()
  }

  const loadEvents = useCallback((info, success, fail) => {
    const params = { start: info.startStr, end: info.endStr }
    if (typeFilter) params.type = typeFilter
    getAppointments(params)
      .then(data => success(data.map(toFCEvent)))
      .catch(fail)
  }, [typeFilter])

  function handleSelect(info) {
    setModal({ mode: 'create', slot: info })
    info.view.calendar.unselect()
  }

  function handleEventClick(info) {
    setModal({ mode: 'edit', appt: info.event.extendedProps._raw })
  }

  async function handleEventDrop(info) {
    try {
      await updateAppointment(info.event.id, {
        start:  info.event.startStr,
        end:    info.event.endStr || undefined,
        allDay: info.event.allDay,
      })
      fetchToday()
    } catch {
      info.revert()
      toast.error('Impossible de déplacer le rendez-vous.')
    }
  }

  async function handleEventResize(info) {
    try {
      await updateAppointment(info.event.id, {
        start: info.event.startStr,
        end:   info.event.endStr,
      })
    } catch {
      info.revert()
      toast.error('Impossible de redimensionner.')
    }
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
                <li key={e._id} className="plan-today-item"
                  onClick={() => setModal({ mode: 'edit', appt: e })}>
                  <span className="plan-today-dot"
                    style={{ background: TYPE_MAP[e.type]?.color || '#6b7280' }} />
                  <div>
                    <div className="plan-today-title">{e.title}</div>
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
            if (status === 'fait')   cls.push('fc-event--fait')
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
        <AppointmentModal
          mode={modal.mode}
          slot={modal.slot}
          appt={modal.appt}
          users={users}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refetch() }}
          onDeleted={() => { setModal(null); refetch() }}
        />
      )}
    </div>
  )
}
