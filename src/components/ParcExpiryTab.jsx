import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, X, AlertTriangle, Clock, CheckCircle2, BatteryWarning, Zap,
  Users, MapPin, ExternalLink, HeartPulse,
} from 'lucide-react'
import { getInstallations } from '../api/installations'

/**
 * Échéances du parc : les consommables posés chez les clients — batteries et
 * électrodes — rangés par date de péremption.
 *
 * Le stock de l'entrepôt vit dans les articles ; ceci couvre l'autre moitié,
 * ce qui est déjà installé et qu'il faudra remplacer. Les deux se lisent au
 * même endroit, mais ne se mélangent pas : ici rien n'est décompté d'un stock.
 */

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function expiryLevel(days) {
  if (days == null)  return { level: 'none',    label: 'Non renseignée' }
  if (days < 0)      return { level: 'expired', label: `Expiré depuis ${-days} j` }
  if (days <= 30)    return { level: 'urgent',  label: `${days} j` }
  if (days <= 90)    return { level: 'soon',    label: `${days} j` }
  return { level: 'ok', label: `${days} j` }
}

const HORIZONS = [
  { value: 'expired', label: 'Déjà expirés' },
  { value: '30',      label: 'Sous 30 jours' },
  { value: '90',      label: 'Sous 90 jours' },
  { value: '',        label: 'Toutes échéances' },
]

const TYPES = [
  { value: '',           label: 'Batteries et électrodes' },
  { value: 'batterie',   label: 'Batteries seules' },
  { value: 'electrode',  label: 'Électrodes seules' },
]

export default function ParcExpiryTab({ initialType = '' }) {
  const navigate = useNavigate()

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [type,    setType]    = useState(initialType)
  const [horizon, setHorizon] = useState('90')

  useEffect(() => {
    let alive = true
    getInstallations({ limit: 500 })
      .then(res => {
        if (!alive) return
        const list = Array.isArray(res) ? res : (res.data || [])

        // Une ligne par consommable, pas par appareil : c'est le consommable
        // qu'on vient remplacer, et un DAE peut en avoir plusieurs en retard.
        const flat = []
        for (const inst of list) {
          const dea = {
            id:         inst._id,
            deviceType: inst.deviceType || 'DAE',
            serial:     inst.serialNumber || '',
            client:     inst.client?.name || inst.clientName || '',
            place:      inst.location || inst.address || '',
          }
          for (const b of inst.batteries || []) {
            flat.push({
              key: `${inst._id}-b-${b._id || b.serialNumber || flat.length}`,
              kind: 'batterie', label: b.productName || 'Batterie',
              ident: b.serialNumber || '', expiry: b.expiryDate, ...dea,
            })
          }
          for (const e of inst.electrodes || []) {
            flat.push({
              key: `${inst._id}-e-${e._id || e.lotNumber || flat.length}`,
              kind: 'electrode',
              label: e.productName || `Électrodes${e.kind ? ` ${e.kind}` : ''}`,
              ident: e.lotNumber || '', expiry: e.expiryDate, ...dea,
            })
          }
        }
        // Les plus urgents en tête ; ceux sans date ferment la marche.
        flat.sort((a, b) => {
          const da = a.expiry ? new Date(a.expiry).getTime() : Infinity
          const db = b.expiry ? new Date(b.expiry).getTime() : Infinity
          return da - db
        })
        setRows(flat)
      })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const stats = useMemo(() => {
    let expired = 0, in30 = 0, in90 = 0, missing = 0
    for (const r of rows) {
      const d = daysUntil(r.expiry)
      if (d == null)   { missing++; continue }
      if (d < 0)         expired++
      else if (d <= 30)  in30++
      else if (d <= 90)  in90++
    }
    return [
      { key: 'expired', tone: 'ember', icon: AlertTriangle, label: 'Déjà expirés',   value: expired, alert: true },
      { key: 'in30',    tone: 'sun',   icon: Clock,         label: 'Sous 30 jours',  value: in30,    alert: true },
      { key: 'in90',    tone: 'sky',   icon: Clock,         label: 'Sous 90 jours',  value: in90 },
      { key: 'missing', tone: 'slate', icon: CheckCircle2,  label: 'Sans échéance',  value: missing },
    ]
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (type && r.kind !== type) return false
      if (q && ![r.client, r.place, r.serial, r.ident, r.label, r.deviceType]
        .some(v => v?.toLowerCase().includes(q))) return false
      if (horizon) {
        const d = daysUntil(r.expiry)
        if (d == null) return false
        if (horizon === 'expired') return d < 0
        return d <= Number(horizon)
      }
      return true
    })
  }, [rows, search, type, horizon])

  return (
    <>
      <div className="cat-stats-row">
        {stats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.key}
              className={`cat-stat cat-stat--${s.tone}${s.alert && s.value > 0 ? ' cat-stat--alert' : ''}`}>
              <span className="cat-stat-icon"><Icon size={15} strokeWidth={2.2} /></span>
              <span className="cat-stat-value">{s.value}</span>
              <span className="cat-stat-label">{s.label}</span>
            </div>
          )
        })}
      </div>

      <div className="table-toolbar cat-filters">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="Client, emplacement, n° de série, lot…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>

        <select className="cat-filter-select" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <select className="cat-filter-select" value={horizon} onChange={e => setHorizon(e.target.value)}>
          {HORIZONS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="table-empty">
          <HeartPulse size={36} color="var(--gray-300)" />
          <p>Aucun consommable enregistré sur le parc.</p>
          <span className="pd-empty-note">
            Les batteries et électrodes se saisissent sur la fiche d'un DAE, chez le client.
          </span>
        </div>
      ) : visible.length === 0 ? (
        <div className="table-empty">
          <CheckCircle2 size={36} color="var(--green-500)" />
          <p>Rien à remplacer sur cet horizon.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Consommable</th>
                <th>N° série / lot</th>
                <th>Échéance</th>
                <th>Appareil</th>
                <th>Client</th>
                <th>Emplacement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const d   = daysUntil(r.expiry)
                const exp = expiryLevel(d)
                const KindIcon = r.kind === 'batterie' ? BatteryWarning : Zap
                return (
                  <tr key={r.key} className="mv-row--clickable" onClick={() => navigate(`/devices/${r.id}`)}>
                    <td>
                      <span className="parc-kind">
                        <KindIcon size={13} className={`parc-kind-icon parc-kind-icon--${r.kind}`} />
                        {r.label}
                      </span>
                    </td>
                    <td>
                      {r.ident
                        ? <span className={r.kind === 'batterie' ? 'mv-serial-chip' : 'mv-lot-chip'}>{r.ident}</span>
                        : <span className="cell-muted">—</span>}
                    </td>
                    <td>
                      <span className={`item-exp item-exp--${exp.level}`}>
                        {r.expiry ? formatDate(r.expiry) : '—'}
                        {d != null && <> · {exp.label}</>}
                      </span>
                    </td>
                    <td>
                      <div className="cell-primary">{r.deviceType}</div>
                      {r.serial && <div className="cell-secondary">n° {r.serial}</div>}
                    </td>
                    <td>
                      {r.client
                        ? <span className="cell-primary"><Users size={11} /> {r.client}</span>
                        : <span className="cell-muted">—</span>}
                    </td>
                    <td className="cell-muted">
                      {r.place ? <><MapPin size={11} /> {r.place}</> : '—'}
                    </td>
                    <td><ExternalLink size={13} className="cell-muted" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
