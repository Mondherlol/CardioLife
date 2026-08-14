import { X, Calendar, Clock, User, Users, Building2, StickyNote, Eye } from 'lucide-react'
import { TYPE_MAP, STATUS_MAP } from '../lib/appointmentConstants'

/**
 * Rendez-vous en consultation seule.
 *
 * Le technicien exécute le planning : il doit savoir quoi, quand et chez qui,
 * sans pouvoir le déplacer ni le modifier. D'où une vue dédiée plutôt qu'une
 * modale d'édition neutralisée — rien à désactiver, donc rien à oublier.
 */
export default function AppointmentViewModal({ appointment, onClose }) {
  if (!appointment) return null

  const a      = appointment
  const type   = TYPE_MAP[a.type]     || TYPE_MAP.autre
  const status = STATUS_MAP[a.status] || STATUS_MAP.planifie

  const start = a.start ? new Date(a.start) : null
  const end   = a.end   ? new Date(a.end)   : null

  const dateLabel = start
    ? start.toLocaleDateString('fr-FR', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      })
    : '—'

  const hourLabel = !start ? '' : a.allDay
    ? 'Toute la journée'
    : [start, end].filter(Boolean)
        .map(d => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
        .join(' – ')

  const people = (a.assignedTo || [])
    .map(u => u.fullName || u.username)
    .filter(Boolean)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><Eye size={16} /> Rendez-vous</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="apv-head">
            <span className="apv-type" style={{ background: type.color }}>{type.label}</span>
            <span className="apv-status" style={{ color: status.color, borderColor: status.color }}>
              {status.label}
            </span>
          </div>

          <h3 className="apv-title">{a.title}</h3>

          <div className="apv-rows">
            <div className="apv-row">
              <Calendar size={13} />
              <span className="apv-row-value apv-row-value--strong">{dateLabel}</span>
            </div>
            {hourLabel && (
              <div className="apv-row">
                <Clock size={13} />
                <span className="apv-row-value">{hourLabel}</span>
              </div>
            )}
            {(a.clientName || a.client?.name) && (
              <div className="apv-row">
                <Building2 size={13} />
                <span className="apv-row-value">{a.clientName || a.client?.name}</span>
              </div>
            )}
            {people.length > 0 && (
              <div className="apv-row">
                {people.length > 1 ? <Users size={13} /> : <User size={13} />}
                <span className="apv-row-value">{people.join(', ')}</span>
              </div>
            )}
            {a.description && (
              <div className="apv-row apv-row--block">
                <StickyNote size={13} />
                <span className="apv-row-value">{a.description}</span>
              </div>
            )}
          </div>

          <p className="apv-note">
            Ce rendez-vous est planifié par le bureau. Contactez-le pour toute modification.
          </p>

          <div className="modal-footer">
            <button className="btn btn--primary" onClick={onClose}>Fermer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
