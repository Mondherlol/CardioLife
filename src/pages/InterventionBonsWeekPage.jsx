import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { getInterventions, getIntervention } from '../api/interventions'
import { getAppSettings } from '../api/appSettings'
import { localDateStr } from '../lib/appointmentConstants'
import {
  BonDocument, FALLBACK_COMPANY, bonLines, savedNatures, suggestNature,
} from './InterventionBonPage'

/** Lundi de la semaine de `d`, à minuit. */
function mondayOf(d) {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

const fmtDay = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })

/**
 * Bons d'intervention de la semaine, à imprimer d'un coup pour la tournée.
 *
 * Chaque visite planifiée sur la semaine donne une page A4, telle que la page
 * d'un bon l'imprimerait : mêmes références, mêmes natures enregistrées. Une
 * visite pas encore faite reprend la nature proposée par son type et liste les
 * DAE qu'elle vise.
 *
 * `?semaine=AAAA-MM-JJ` : n'importe quel jour de la semaine voulue.
 */
export default function InterventionBonsWeekPage() {
  const [params, setParams] = useSearchParams()
  const monday = useMemo(
    () => mondayOf(params.get('semaine') ? new Date(`${params.get('semaine')}T12:00`) : new Date()),
    [params])
  const sunday = useMemo(() => {
    const s = new Date(monday); s.setDate(s.getDate() + 6); s.setHours(23, 59, 59, 999); return s
  }, [monday])

  const [items,    setItems]    = useState(null)   // interventions détaillées
  const [error,    setError]    = useState('')
  const [company,  setCompany]  = useState(FALLBACK_COMPANY)
  const [tech,     setTech]     = useState('')
  // Visites décochées : elles restent listées mais ne s'impriment pas.
  const [excluded, setExcluded] = useState(() => new Set())

  useEffect(() => {
    getAppSettings()
      .then(s => s?.company && setCompany({ ...FALLBACK_COMPANY, ...s.company }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    setItems(null)
    setError('')
    setExcluded(new Set())
    getInterventions({ from: monday.toISOString(), to: sunday.toISOString() })
      .then(list => Promise.all((Array.isArray(list) ? list : [])
        // Le détail porte le parc du site : sans lui, le bon ne nomme pas les DAE.
        .map(iv => getIntervention(iv._id).catch(() => iv))))
      .then(full => {
        if (!alive) return
        setItems(full.sort((a, b) =>
          new Date(a.scheduledDate) - new Date(b.scheduledDate)
          || String(a.clientName || '').localeCompare(String(b.clientName || ''))))
      })
      .catch(err => { if (alive) setError(err.message || 'Chargement impossible.') })
    return () => { alive = false }
  }, [monday, sunday])

  useEffect(() => {
    document.title = `Bons d'intervention — semaine du ${monday.toLocaleDateString('fr-FR')}`
  }, [monday])

  const techs = useMemo(() => {
    const m = new Map()
    ;(items || []).forEach(iv => {
      const name = iv.technicienName || iv.technicien?.fullName
      if (name) m.set(name, name)
    })
    return [...m.keys()].sort()
  }, [items])

  const visible = (items || []).filter(iv =>
    !tech || (iv.technicienName || iv.technicien?.fullName) === tech)
  const printed = visible.filter(iv => !excluded.has(iv._id))

  function shiftWeek(n) {
    const d = new Date(monday); d.setDate(d.getDate() + 7 * n)
    setParams({ semaine: localDateStr(d) })
  }

  function toggle(id) {
    setExcluded(cur => {
      const next = new Set(cur)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="bi-wrap">
      <div className="bi-bar bi-week-bar no-print">
        <div className="bi-week-nav">
          <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(-1)} title="Semaine précédente">
            <ChevronLeft size={15} />
          </button>
          <strong>
            Semaine du {monday.toLocaleDateString('fr-FR')} au {sunday.toLocaleDateString('fr-FR')}
          </strong>
          <button className="btn btn--ghost btn--sm" onClick={() => shiftWeek(1)} title="Semaine suivante">
            <ChevronRight size={15} />
          </button>
        </div>

        {techs.length > 1 && (
          <div className="bi-bar-group bi-bar-group--sm" style={{ maxWidth: 220 }}>
            <label className="bi-bar-label">Technicien</label>
            <select className="form-input form-input--plain" value={tech} onChange={e => setTech(e.target.value)}>
              <option value="">Tous</option>
              {techs.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        <div className="bi-bar-actions">
          <button className="btn btn--primary" onClick={() => window.print()} disabled={!printed.length}>
            <Printer size={14} /> Imprimer {printed.length} bon{printed.length > 1 ? 's' : ''}
          </button>
        </div>

        {visible.length > 0 && (
          <div className="bi-bar-group bi-bar-group--full">
            <span className="bi-bar-label">Visites de la semaine — décochez celles à ne pas imprimer</span>
            <div className="bi-week-list">
              {visible.map(iv => {
                const on = !excluded.has(iv._id)
                return (
                  <label key={iv._id} className={`bi-nature${on ? ' bi-nature--on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(iv._id)} />
                    <span className="bi-week-day">{fmtDay(new Date(iv.scheduledDate))}</span>
                    {iv.clientName || '—'}
                    {iv.siteName && iv.siteName !== iv.clientName && <span className="text-muted"> · {iv.siteName}</span>}
                    {iv.objet && <span className="text-muted"> · {iv.objet}</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="bi-week-empty">{error}</div>
      ) : items === null ? (
        <div className="bi-week-empty"><span className="spinner" /> Chargement des visites…</div>
      ) : visible.length === 0 ? (
        <div className="bi-week-empty">Aucune visite planifiée cette semaine.</div>
      ) : (
        printed.map(iv => {
          const saved   = savedNatures(iv.bon)
          const natures = saved.length ? saved : suggestNature(iv)
          return (
            <div key={iv._id} className="bi-week-page">
              <BonDocument
                iv={iv}
                company={company}
                reference={iv.bon?.reference || ''}
                bc={iv.bon?.bonCommande || ''}
                signer={iv.bon?.signataire || iv.visite?.visa || ''}
                lines={bonLines(iv, natures, iv.bon?.designations || {})}
              />
            </div>
          )
        })
      )}
    </div>
  )
}
