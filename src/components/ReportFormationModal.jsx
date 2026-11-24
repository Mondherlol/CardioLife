import { useState } from 'react'
import { X, CalendarClock, PauseCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'react-toastify'
import { setFormationAttente } from '../api/formations'

function dayStr(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
function inDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return dayStr(d)
}

/* Raccourcis de relance : le cas courant est « on rappelle dans une semaine /
   un mois », pas une date précise. */
const RELANCES = [
  { label: '1 semaine', days: 7 },
  { label: '2 semaines', days: 14 },
  { label: '1 mois', days: 30 },
  { label: '3 mois', days: 90 },
]

/**
 * Reporter une formation : à une date connue, ou « date à définir ».
 *
 * Le second cas est le plus fréquent — le client veut repousser mais ne sait
 * pas quand. La séance quitte alors le calendrier pour la liste « En attente
 * de planification », avec un motif et une date à laquelle rappeler le client.
 *
 * Props :
 *  formation    - la séance (pour son titre et sa date actuelle), facultative
 *                 quand on reporte depuis une visite sans séance identifiée
 *  initialMode  - 'attente' (défaut) | 'date'
 *  onSubmit     - (payload) => Promise, facultatif. La fiche de visite passe le
 *                 sien (route de l'intervention) ; sinon on appelle la route de
 *                 la formation. payload : { enAttente, motif, relanceDate } ou
 *                 { enAttente: false, date }.
 *  onDone       - (résultat) => void
 */
export default function ReportFormationModal({ formation, initialMode = 'attente', onSubmit, onClose, onDone }) {
  const [mode,    setMode]    = useState(initialMode)
  const [date,    setDate]    = useState('')
  const [time,    setTime]    = useState(() => {
    if (!formation?.date) return '09:00'
    const d = new Date(formation.date)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [motif,   setMotif]   = useState(formation?.enAttente ? (formation.attenteMotif || '') : '')
  const [relance, setRelance] = useState(formation?.relanceDate ? dayStr(formation.relanceDate) : inDays(14))
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    let payload
    if (mode === 'date') {
      if (!date) { setError('Choisissez la nouvelle date.'); return }
      payload = { enAttente: false, date: new Date(`${date}T${time || '09:00'}`).toISOString() }
    } else {
      payload = { enAttente: true, motif: motif.trim(), relanceDate: relance || null }
    }

    setBusy(true)
    try {
      const result = onSubmit
        ? await onSubmit(payload)
        : await setFormationAttente(formation._id, payload)
      toast.success(mode === 'date'
        ? 'Formation reprogrammée.'
        : 'Formation reportée — elle attend sa date dans « En attente de planification ».')
      onDone?.(result)
    } catch (err) {
      setError(err.message || 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><CalendarClock size={16} /> Reporter la formation</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          {formation?.title && (
            <p className="form-hint" style={{ marginTop: 0 }}>
              {formation.title}
              {formation.date && <> · {formation.enAttente ? 'initialement prévue le' : 'prévue le'}{' '}
                {new Date(formation.date).toLocaleDateString('fr-FR')}</>}
            </p>
          )}

          <div className="form-group">
            <label className="form-label">Le client a-t-il donné une nouvelle date ?</label>
            <div className="dea-chips">
              <button type="button" className={`dea-chip${mode === 'attente' ? ' dea-chip--on' : ''}`}
                onClick={() => setMode('attente')}>
                <PauseCircle size={12} /> Pas encore — date à définir
              </button>
              <button type="button" className={`dea-chip${mode === 'date' ? ' dea-chip--on' : ''}`}
                onClick={() => setMode('date')}>
                <CalendarClock size={12} /> Oui, nouvelle date
              </button>
            </div>
          </div>

          {mode === 'date' ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Nouvelle date *</label>
                <input type="date" className="form-input" value={date} min={dayStr(new Date())}
                  onChange={e => setDate(e.target.value)} autoFocus />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Heure</label>
                <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
          ) : (
            <>
              <p className="form-hint">
                La formation reste due mais quitte le calendrier : elle apparaît dans
                « En attente de planification » jusqu'à ce qu'on lui donne une date.
              </p>
              <div className="form-group">
                <label className="form-label">Motif</label>
                <input className="form-input" value={motif} onChange={e => setMotif(e.target.value)}
                  placeholder="ex. Client rappelle après les congés, liste des agents pas prête…" />
              </div>
              <div className="form-group">
                <label className="form-label">Relancer le client le</label>
                <input type="date" className="form-input" value={relance} min={dayStr(new Date())}
                  onChange={e => setRelance(e.target.value)} />
                <div className="dea-chips" style={{ marginTop: 6 }}>
                  {RELANCES.map(r => (
                    <button key={r.days} type="button"
                      className={`dea-chip${relance === inDays(r.days) ? ' dea-chip--on' : ''}`}
                      onClick={() => setRelance(inDays(r.days))}>
                      Dans {r.label}
                    </button>
                  ))}
                  <button type="button" className={`dea-chip${!relance ? ' dea-chip--on' : ''}`}
                    onClick={() => setRelance('')}>
                    Pas de relance
                  </button>
                </div>
                <p className="form-hint">Passé ce jour, la formation remonte en alerte sur le tableau de bord.</p>
              </div>
            </>
          )}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <span className="login-btn-spinner" /> : mode === 'date' ? 'Reprogrammer' : 'Mettre en attente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
