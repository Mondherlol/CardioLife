const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const dates = ['19', '20', '21', '22', '23', '24']
const todayIdx = 1

const events = [
  { day: 0, type: 'maintenance',  time: '09:00', label: 'Contrôle DAE — Hôtel Marina',         tech: 'Mohamed A.' },
  { day: 1, type: 'installation', time: '11:00', label: 'Installation DAE — Clinique Carthage', tech: 'Yassine B.' },
  { day: 1, type: 'formation',    time: '14:30', label: 'Formation — Polyclinique Tunis',        tech: 'Sara K.' },
  { day: 2, type: 'maintenance',  time: '10:00', label: 'Remplacement électrodes — Usine STIP', tech: 'Mohamed A.' },
  { day: 3, type: 'contrat',      time: '09:30', label: 'Renouvellement contrat — TunisAir',    tech: 'Commercial' },
  { day: 4, type: 'controle',     time: '08:00', label: 'Contrôle mensuel — Aéroport Monastir', tech: 'Yassine B.' },
]

const typeStyles = {
  maintenance:  { border: '#3b82f6', dot: '#3b82f6', text: '#1e40af' },
  installation: { border: '#22c55e', dot: '#22c55e', text: '#15803d' },
  formation:    { border: '#a855f7', dot: '#a855f7', text: '#7e22ce' },
  contrat:      { border: '#f97316', dot: '#f97316', text: '#c2410c' },
  controle:     { border: '#f59e0b', dot: '#f59e0b', text: '#92400e' },
}

export default function WeekCalendar() {
  return (
    <div className="widget">
      <div className="widget-header">
        <h2 className="widget-title">Semaine du 19 – 24 mai 2025</h2>
        <span className="widget-badge widget-badge--orange">6 événements</span>
      </div>

      <div className="calendar-days">
        {days.map((d, i) => (
          <div key={d} className={`cal-day${i === todayIdx ? ' cal-day--today' : ''}`}>
            <span className="cal-day-name">{d}</span>
            <span className="cal-day-num">{dates[i]}</span>
          </div>
        ))}
      </div>

      <div className="event-list">
        {events.map((ev, i) => {
          const s = typeStyles[ev.type]
          return (
            <div key={i} className="event-item" style={{ borderLeftColor: s.border }}>
              <div className="event-dot" style={{ background: s.dot }} />
              <div className="event-info">
                <p className="event-label" style={{ color: s.text }}>{ev.label}</p>
                <p className="event-meta">{ev.time} · {ev.tech}</p>
              </div>
              <span className="event-day-tag">{days[ev.day]} {dates[ev.day]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
