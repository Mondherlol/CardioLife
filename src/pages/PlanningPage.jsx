import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin   from '@fullcalendar/daygrid'
import timeGridPlugin  from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin      from '@fullcalendar/list'
import frLocale        from '@fullcalendar/core/locales/fr'
import { Calendar, Plus, X, AlertTriangle, Trash2, Search, Check, ChevronDown, Users, Wrench, Zap } from 'lucide-react'
import { toast } from 'react-toastify'
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
} from '../api/appointments'
import { getInterventions } from '../api/interventions'
import { getInstallations } from '../api/installations'
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

// Types proposés dans la modal : contrôles et installations exclus (ils se créent
// depuis la page Contrôles / les contrats et apparaissent quand même ici).
const MODAL_TYPE_OPTS = TYPE_OPTS.filter(t => !['controle', 'intervention', 'installation'].includes(t.value))

// Durées prédéfinies (en minutes). 1 h par défaut.
const DURATION_OPTS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 h' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 h' },
  { value: 180, label: '3 h' },
  { value: 240, label: '4 h' },
  { value: 480, label: 'Journée (8 h)' },
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

const pad2 = n => String(n).padStart(2, '0')
function localDateStr(d) { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function localTimeStr(d) { d = new Date(d); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

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

  const baseSrc  = (isEdit && raw.start) ? raw.start : (slot?.startStr || new Date().toISOString())
  const initDate = localDateStr(baseSrc)
  const initTime = (() => {
    if (isEdit && raw.start && !raw.allDay) return localTimeStr(raw.start)
    if (slot?.startStr && !slot.allDay)     return localTimeStr(slot.startStr)
    return '08:00'
  })()
  const initDuration = (() => {
    if (isEdit && raw.start && raw.end) {
      const m = Math.round((new Date(raw.end) - new Date(raw.start)) / 60000)
      if (m > 0) return m
    }
    if (slot?.startStr && slot?.endStr && !slot.allDay) {
      const m = Math.round((new Date(slot.endStr) - new Date(slot.startStr)) / 60000)
      if (m > 0) return m
    }
    return 60
  })()

  const [form, setForm] = useState({
    title:       isEdit ? raw.title  : '',
    type:        isEdit ? (raw.type || 'autre') : 'autre',
    status:      isEdit ? raw.status : 'planifie',
    date:        initDate,
    time:        initTime,
    duration:    initDuration,
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

  // Garantit que la durée / le type courant figurent dans les listes déroulantes
  const durationOptions = DURATION_OPTS.some(o => o.value === form.duration)
    ? DURATION_OPTS
    : [...DURATION_OPTS, { value: form.duration, label: `${form.duration} min` }].sort((a, b) => a.value - b.value)
  const typeOptions = MODAL_TYPE_OPTS.some(t => t.value === form.type)
    ? MODAL_TYPE_OPTS
    : [...MODAL_TYPE_OPTS, TYPE_MAP[form.type]].filter(Boolean)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Le titre est requis.')
    if (!form.date)         return setError('La date est requise.')
    const start = new Date(`${form.date}T${form.time || '08:00'}`)
    if (isNaN(start.getTime())) return setError('Date ou heure invalide.')
    const end = new Date(start.getTime() + (Number(form.duration) || 60) * 60000)
    setLoading(true)
    setError('')
    try {
      const payload = {
        title:       form.title.trim(),
        type:        form.type,
        status:      form.status,
        allDay:      false,
        start:       start.toISOString(),
        end:         end.toISOString(),
        client:      form.clientId   || undefined,
        clientName:  form.clientName || undefined,
        assignedTo:  form.assignedTo.map(u => u._id),
        description: form.description || undefined,
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
                {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input className="form-input form-input--plain" type="date"
                value={form.date}
                onChange={e => set('date', e.target.value)}
                required />
            </div>
            <div className="form-group">
              <label className="form-label">Heure *</label>
              <input className="form-input form-input--plain" type="time"
                value={form.time}
                onChange={e => set('time', e.target.value)}
                required />
            </div>
            <div className="form-group">
              <label className="form-label">Durée</label>
              <select className="form-input form-input--plain"
                value={form.duration}
                onChange={e => set('duration', Number(e.target.value))}>
                {durationOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
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
    ]).then(([appts, intvs, instRes]) => {
      const insts = Array.isArray(instRes) ? instRes : (instRes?.data || [])
      const items = [
        ...(Array.isArray(appts) ? appts : []).map(a => ({ ...a, _kind: 'appointment' })),
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
    // à installer). Un filtre par type ne montre que la source correspondante.
    const wantAppt = !typeFilter || !['intervention', 'installation'].includes(typeFilter)
    const wantIntv = !typeFilter || typeFilter === 'intervention'
    const wantInst = !typeFilter || typeFilter === 'installation'

    const apptP = wantAppt
      ? getAppointments({
          start: info.startStr, end: info.endStr,
          ...(typeFilter && !['intervention', 'installation'].includes(typeFilter) ? { type: typeFilter } : {}),
        }).catch(() => [])
      : Promise.resolve([])
    const intvP = wantIntv
      ? getInterventions({ from: info.startStr, to: info.endStr }).catch(() => [])
      : Promise.resolve([])
    const instP = wantInst
      ? getInstallations({ status: 'a_installer', from: info.startStr, to: info.endStr }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] })

    Promise.all([apptP, intvP, instP])
      .then(([appts, intvs, instRes]) => {
        const insts = Array.isArray(instRes) ? instRes : (instRes?.data || [])
        success([
          ...(Array.isArray(appts) ? appts : []).map(toFCEvent),
          ...(Array.isArray(intvs) ? intvs : []).filter(i => i.scheduledDate).map(toInterventionEvent),
          ...insts.filter(i => i.scheduledDate).map(toInstallationEvent),
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
    setModal({ mode: 'edit', appt: ep._raw })
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
                <li key={`${e._kind}-${e._id}`} className="plan-today-item"
                  onClick={() => e._kind === 'intervention'
                    ? navigate(`/interventions/${e._id}`)
                    : e._kind === 'installation'
                      ? navigate(`/devices/${e._id}`)
                      : setModal({ mode: 'edit', appt: e })}>
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
