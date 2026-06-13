import { AlertCircle, AlertTriangle, Clock, CheckCircle, ChevronRight } from 'lucide-react'

const alerts = [
  {
    type: 'critical',
    title: '3 batteries expirent dans moins de 30 jours',
    detail: 'Hôtel Jasmin · Clinique El Amal · École de Commerce',
    tag: 'Urgent',
  },
  {
    type: 'warning',
    title: 'Hôtel Marina — contrôle annuel cette semaine',
    detail: 'Technicien Mohamed A. · DAE ZOLL AED Plus',
    tag: 'Cette semaine',
  },
  {
    type: 'warning',
    title: 'Stock électrodes adulte sous le seuil minimum',
    detail: '4 unités restantes · seuil : 10',
    tag: 'Stock',
  },
  {
    type: 'neutral',
    title: 'Contrat TunisAir expire dans 15 jours',
    detail: 'Contact : M. Ben Salah',
    tag: '15 jours',
  },
  {
    type: 'neutral',
    title: 'DAE Sousse Center — aucun contrôle depuis 12 mois',
    detail: 'Centre Commercial Sousse Center',
    tag: '+12 mois',
  },
  {
    type: 'ok',
    title: '2 interventions réalisées avec succès',
    detail: 'Rapports envoyés aux clients',
    tag: 'Hier',
  },
]

const config = {
  critical: { Icon: AlertCircle,   accent: '#f43f5e', tagBg: '#fff1f2', tagText: '#be123c' },
  warning:  { Icon: AlertTriangle, accent: '#f97316', tagBg: '#fff7ed', tagText: '#c2410c' },
  neutral:  { Icon: Clock,         accent: '#94a3b8', tagBg: '#f8fafc', tagText: '#64748b' },
  ok:       { Icon: CheckCircle,   accent: '#22c55e', tagBg: '#f0fdf4', tagText: '#15803d' },
}

export default function AlertList() {
  return (
    <div className="widget">
      <div className="widget-header">
        <h2 className="widget-title">Alertes prioritaires</h2>
        <span className="widget-badge widget-badge--red">9 actives</span>
      </div>

      <div className="alert-list">
        {alerts.map((a, i) => {
          const { Icon, accent, tagBg, tagText } = config[a.type]
          return (
            <div key={i} className="alert-row" style={{ '--accent': accent }}>
              <div className="alert-row-accent" />
              <div className="alert-row-icon" style={{ color: accent }}>
                <Icon size={15} strokeWidth={2} />
              </div>
              <div className="alert-row-body">
                <span className="alert-row-title">{a.title}</span>
                <span className="alert-row-detail">{a.detail}</span>
              </div>
              <span className="alert-row-tag" style={{ background: tagBg, color: tagText }}>
                {a.tag}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
