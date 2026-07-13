import { useState, useEffect, useCallback } from 'react'
import { Calendar, Plus, Clock, CheckCircle2, User } from 'lucide-react'
import { getAppointments } from '../api/appointments'
import { getUsers } from '../api/users'
import EventModal from './EventModal'
import { TYPE_MAP, STATUS_MAP } from '../lib/appointmentConstants'

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function PlanningClientTab({ clientId, clientName }) {
  const [appointments, setAppointments] = useState([])
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [modal,        setModal]        = useState(null)   // { mode, appt? }

  const load = useCallback(() => {
    getAppointments({ client: clientId })
      .then(data => setAppointments(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getUsers().then(data => setUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  const now      = new Date()
  const upcoming = appointments.filter(a => new Date(a.start) >= now && a.status !== 'annule')
  const past     = appointments.filter(a => new Date(a.start) < now || a.status === 'annule')

  const renderCard = (a) => {
    const tc = TYPE_MAP[a.type]   || TYPE_MAP.autre
    const sc = STATUS_MAP[a.status] || STATUS_MAP.planifie
    const assigned = (a.assignedTo || []).filter(Boolean)

    return (
      <div
        key={a._id}
        className="ctrl-card ctrl-card--clickable"
        onClick={() => setModal({ mode: 'edit', entity: a })}
      >
        <div className="ctrl-card-left">
          <span className="ctrl-type-badge" style={{ background: tc.color + '22', color: tc.color }}>
            {tc.label}
          </span>
          <span className="ctrl-date">{fmtDateTime(a.start)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.title}</span>
          {assigned.length > 0 && (
            <span className="ctrl-tech">
              <User size={11} /> {assigned.map(u => u.fullName || u.username).filter(Boolean).join(', ')}
            </span>
          )}
        </div>
        <div className="ctrl-card-actions">
          <span
            className="fmn-chip"
            style={{ background: sc.color + '22', color: sc.color }}
          >
            {sc.label}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="ctrl-tab">
      <div className="ctrl-tab-bar">
        <div className="ctrl-tab-counts">
          <span className="ctrl-count-chip ctrl-count-chip--upcoming">{upcoming.length} à venir</span>
          <span className="ctrl-count-chip ctrl-count-chip--done">{past.length} passé{past.length > 1 ? 's' : ''}</span>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'create' })}>
          <Plus size={13} /> Nouveau RDV
        </button>
      </div>

      {appointments.length === 0 ? (
        <div className="cd-tab-empty">
          <Calendar size={40} color="var(--gray-300)" />
          <p>Aucun rendez-vous planifié pour ce client.</p>
          <button className="btn btn--ghost btn--sm" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={13} /> Planifier un RDV
          </button>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="ctrl-section">
              <h4 className="ctrl-section-title"><Clock size={14} /> À venir</h4>
              <div className="ctrl-list">
                {upcoming.map(renderCard)}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section className="ctrl-section">
              <h4 className="ctrl-section-title"><CheckCircle2 size={14} /> Passés</h4>
              <div className="ctrl-list">
                {past.map(renderCard)}
              </div>
            </section>
          )}
        </>
      )}

      {modal && (
        <EventModal
          mode={modal.mode}
          entity={modal.entity}
          entityKind="appointment"
          users={users}
          presetClient={{ id: clientId, name: clientName }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
          onDeleted={() => { setModal(null); load() }}
          onChanged={() => load()}
        />
      )}
    </div>
  )
}
