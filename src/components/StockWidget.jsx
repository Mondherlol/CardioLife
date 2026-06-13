const items = [
  { name: 'Défibrillateurs ZOLL AED Plus',      qty: 8,  min: 3,  unit: 'unités', status: 'ok' },
  { name: 'Défibrillateurs Philips HeartStart',  qty: 5,  min: 3,  unit: 'unités', status: 'ok' },
  { name: 'Électrodes adulte universelles',       qty: 4,  min: 10, unit: 'paires', status: 'critical' },
  { name: 'Électrodes pédiatriques',              qty: 7,  min: 5,  unit: 'paires', status: 'warning' },
  { name: 'Batteries ZOLL',                       qty: 6,  min: 5,  unit: 'unités', status: 'warning' },
  { name: 'Batteries Philips',                    qty: 12, min: 5,  unit: 'unités', status: 'ok' },
  { name: 'Boîtiers muraux',                      qty: 3,  min: 2,  unit: 'unités', status: 'ok' },
  { name: 'Kits de secours',                      qty: 2,  min: 5,  unit: 'kits',   status: 'critical' },
]

const statusStyle = {
  ok:       { label: 'OK',       bg: 'var(--green-50)',  text: 'var(--green-700)',  bar: 'var(--green-500)' },
  warning:  { label: 'Bas',      bg: 'var(--amber-50)',  text: 'var(--amber-600)',  bar: 'var(--amber-500)' },
  critical: { label: 'Critique', bg: 'var(--red-50)',    text: 'var(--red-700)',    bar: 'var(--red-500)' },
}

export default function StockWidget() {
  return (
    <div className="widget">
      <div className="widget-header">
        <h2 className="widget-title">État du stock</h2>
        <span className="widget-badge widget-badge--red">2 critiques</span>
      </div>
      <div className="stock-list">
        {items.map((item, i) => {
          const s = statusStyle[item.status]
          const pct = Math.min(100, Math.round((item.qty / Math.max(item.min * 2, item.qty)) * 100))
          return (
            <div key={i} className="stock-item">
              <div className="stock-item-header">
                <span className="stock-name">{item.name}</span>
                <span className="stock-tag" style={{ background: s.bg, color: s.text }}>{s.label}</span>
              </div>
              <div className="stock-bar-row">
                <div className="stock-bar-track">
                  <div className="stock-bar-fill" style={{ width: `${pct}%`, background: s.bar }} />
                </div>
                <span className="stock-qty">{item.qty} / {item.min * 2} {item.unit}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
