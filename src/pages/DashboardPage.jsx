import StatCard      from '../components/StatCard'
import AlertList     from '../components/AlertList'
import WeekCalendar  from '../components/WeekCalendar'
import MapPlaceholder from '../components/MapPlaceholder'
import StockWidget   from '../components/StockWidget'

export default function DashboardPage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-subtitle">Mardi 20 mai 2025</p>
        </div>
        <div className="header-filters">
          {["Aujourd'hui", 'Cette semaine', 'Ce mois', 'Urgent'].map(f => (
            <button key={f} className={`filter-chip${f === 'Cette semaine' ? ' filter-chip--active' : ''}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="DAE installés"        value="47" sub="dans 9 gouvernorats"  color="blue"   icon="device"   />
        <StatCard label="Alertes actives"       value="9"  sub="3 urgentes"           color="red"    icon="alert"    />
        <StatCard label="Contrats actifs"       value="31" sub="4 à renouveler"       color="green"  icon="contract" />
        <StatCard label="Interventions ce mois" value="12" sub="2 en retard"          color="orange" icon="wrench"   />
      </div>

      <div className="mid-grid">
        <AlertList />
        <WeekCalendar />
      </div>

      <div className="bottom-grid">
        <MapPlaceholder />
        <StockWidget />
      </div>
    </div>
  )
}
