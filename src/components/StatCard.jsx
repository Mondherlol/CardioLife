import { Monitor, AlertTriangle, FileText, Wrench } from 'lucide-react'

const iconMap = {
  device: Monitor,
  alert: AlertTriangle,
  contract: FileText,
  wrench: Wrench,
}

const colorMap = {
  orange: {
    bg: 'var(--orange-50)',
    icon: 'var(--orange-500)',
    value: 'var(--orange-700)',
  },
  red: {
    bg: 'var(--red-50)',
    icon: 'var(--red-500)',
    value: 'var(--red-700)',
  },
  green: {
    bg: 'var(--green-50)',
    icon: 'var(--green-500)',
    value: 'var(--green-700)',
  },
  blue: {
    bg: 'var(--blue-50)',
    icon: 'var(--blue-500)',
    value: 'var(--blue-700)',
  },
}

export default function StatCard({ label, value, sub, color, icon }) {
  const Icon = iconMap[icon]
  const c = colorMap[color]

  return (
    <div className="stat-card">
      <div className="stat-icon-wrap" style={{ background: c.bg, color: c.icon }}>
        <Icon size={20} strokeWidth={1.8} />
      </div>
      <div className="stat-info">
        <p className="stat-label">{label}</p>
        <p className="stat-value" style={{ color: c.value }}>{value}</p>
        <p className="stat-sub">{sub}</p>
      </div>
    </div>
  )
}
