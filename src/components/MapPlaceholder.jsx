const markers = [
  { x: 52, y: 18, status: 'ok',       label: 'Bizerte — 2 DAE' },
  { x: 48, y: 28, status: 'ok',       label: 'Tunis — 12 DAE' },
  { x: 44, y: 34, status: 'warning',  label: 'Nabeul — 4 DAE' },
  { x: 42, y: 38, status: 'ok',       label: 'Hammamet — 3 DAE' },
  { x: 36, y: 42, status: 'critical', label: 'Sousse — 7 DAE' },
  { x: 34, y: 52, status: 'ok',       label: 'Monastir — 5 DAE' },
  { x: 32, y: 62, status: 'warning',  label: 'Sfax — 5 DAE' },
  { x: 30, y: 75, status: 'ok',       label: 'Gabès — 3 DAE' },
  { x: 22, y: 82, status: 'inactive', label: 'Médenine — 2 DAE' },
]

const colors = {
  ok:       'var(--green-500)',
  warning:  'var(--amber-500)',
  critical: 'var(--red-500)',
  inactive: 'var(--gray-400)',
}

const legend = [
  { status: 'ok',       label: 'Conforme' },
  { status: 'warning',  label: 'À contrôler' },
  { status: 'critical', label: 'Urgent' },
  { status: 'inactive', label: 'Inactif' },
]

export default function MapPlaceholder() {
  return (
    <div className="widget widget--map">
      <div className="widget-header">
        <h2 className="widget-title">Carte — DAE installés en Tunisie</h2>
        <div className="map-legend">
          {legend.map(l => (
            <span key={l.status} className="legend-item">
              <span className="legend-dot" style={{ background: colors[l.status] }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="map-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="map-svg">
          <path
            d="M55,5 L62,8 L65,12 L68,10 L72,15 L70,20 L65,22 L68,28 L66,34 L62,38 L60,44 L58,50 L55,56 L52,62 L48,68 L44,74 L40,80 L36,85 L32,90 L28,92 L26,88 L28,82 L30,76 L28,70 L26,64 L28,58 L30,52 L32,46 L30,40 L28,34 L30,28 L34,22 L38,16 L42,10 L48,6 Z"
            fill="#e2e8f0"
            stroke="#cbd5e1"
            strokeWidth="0.4"
          />
          {markers.map((m, i) => (
            <g key={i}>
              <circle cx={m.x} cy={m.y} r="4" fill={colors[m.status]} opacity="0.2" />
              <circle cx={m.x} cy={m.y} r="2.5" fill={colors[m.status]} />
            </g>
          ))}
        </svg>

        <div className="map-labels">
          {markers.map((m, i) => (
            <div key={i} className="map-label-item">
              <span className="map-label-dot" style={{ background: colors[m.status] }} />
              <span className="map-label-text">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="map-info">47 appareils répartis dans 9 gouvernorats</p>
    </div>
  )
}
