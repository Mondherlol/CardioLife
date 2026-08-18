import { useState } from 'react'
import { X, AlertTriangle, CalendarClock, RotateCcw, Info } from 'lucide-react'
import { toast } from 'react-toastify'
import { setDeaNextControl } from '../api/sites'
import { formatApiError, toDateInput, formatDate, daysUntil } from './siteHelpers'

/**
 * Date du prochain contrôle, corrigée depuis la fiche client.
 *
 * Le calendrier automatique part de la pose : sur un parc repris des années
 * après — une installation de 2016 mise sous contrat aujourd'hui — il annonce
 * une échéance qui n'a plus de sens. Ici on pose la vraie date, et la visite
 * planifiée se déplace avec elle : la fiche client et le planning ne peuvent
 * pas se contredire.
 *
 * Une visite couvre le site entier : la date vaut pour tous ses appareils.
 *
 * Props :
 *  site    - site concerné
 *  dea     - appareil depuis lequel on a ouvert la date
 *  onClose - () => void
 *  onSaved - (site) => void — reçoit le site complet mis à jour
 */
export default function NextControlModal({ site, dea, onClose, onSaved }) {
  const [date,    setDate]    = useState(toDateInput(dea?.nextControlDate))
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const manual = !!dea?.nextControlManual
  const days   = daysUntil(date)
  const others = (site.deas?.length || 1) - 1

  async function save(value) {
    setError('')
    setLoading(true)
    try {
      const updated = await setDeaNextControl(site._id, dea._id, value || null)
      toast.success(value
        ? `Prochain contrôle fixé au ${formatDate(value)}.`
        : 'Échéance rendue au calendrier automatique.')
      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Prochain contrôle</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="modal-body" onSubmit={e => { e.preventDefault(); save(date) }}>
          <p className="dea-modal-site">
            Site : <strong>{site.name}</strong>
            {dea?.deviceType && <> · {dea.deviceType}</>}
            {dea?.serialNumber && <> · n° {dea.serialNumber}</>}
          </p>

          <div className="form-group">
            <label className="form-label">Date de la prochaine visite</label>
            <input type="date" className="form-input form-input--plain" value={date}
              onChange={e => setDate(e.target.value)} autoFocus />

            {date && days != null && (
              <p className="form-hint">
                {days < 0
                  ? `Échéance dépassée de ${Math.abs(days)} jour${Math.abs(days) > 1 ? 's' : ''}.`
                  : days === 0
                    ? "C'est aujourd'hui."
                    : `Dans ${days} jour${days > 1 ? 's' : ''}.`}
              </p>
            )}

            <p className="form-hint">
              <Info size={11} /> La visite planifiée est déplacée à cette date
              {others > 0 && `, pour les ${others + 1} appareils du site`} —
              {' '}une visite couvre le site entier.
            </p>
          </div>

          {manual && (
            <div className="dea-contract-on">
              <CalendarClock size={14} />
              <span>
                Cette échéance a été fixée à la main : le calendrier du contrat ne la
                recalcule plus.
              </span>
            </div>
          )}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            {manual && (
              <button type="button" className="btn btn--ghost" style={{ marginRight: 'auto' }}
                onClick={() => save(null)} disabled={loading}
                title="L'échéance repart du calendrier du contrat">
                <RotateCcw size={13} /> Calcul automatique
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !date}>
              {loading ? <span className="login-btn-spinner" /> : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
