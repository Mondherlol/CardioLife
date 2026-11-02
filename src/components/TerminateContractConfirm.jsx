import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { toast } from 'react-toastify'
import { terminateContract } from '../api/contracts'
import { formatApiError } from './siteHelpers'

function fmt(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function toDateInput(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Sortie du site de son contrat.
 *
 * À l'échéance (le cas courant : on ne renouvelle pas), à une date choisie,
 * ou tout de suite. Le contrat court jusqu'à la date retenue, ses visites
 * au-delà quittent le planning, puis il passe « résilié » de lui-même. Le
 * contrat reste consultable.
 */
export default function TerminateContractConfirm({ contract, siteName, onClose, onDone }) {
  const end       = contract.endDate ? new Date(contract.endDate) : null
  const endFuture = end && end > new Date()

  const [when,    setWhen]    = useState(endFuture ? 'end' : 'now')
  const [date,    setDate]    = useState(endFuture ? toDateInput(end) : toDateInput(new Date()))
  const [reason,  setReason]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function confirm() {
    const body = { reason }
    if (when === 'end')  body.date = toDateInput(end)
    if (when === 'date') {
      if (!date) return setError('Choisissez la date de résiliation.')
      body.date = date
    }
    setLoading(true)
    try {
      const res = await terminateContract(contract._id, body)
      if (res?.scheduled) {
        toast.success(`Résiliation programmée au ${fmt(res.date)}.`)
      } else {
        const n = res?.removedControls || 0
        toast.success(n
          ? `Contrat résilié · ${n} visite${n > 1 ? 's' : ''} planifiée${n > 1 ? 's' : ''} annulée${n > 1 ? 's' : ''}.`
          : 'Contrat résilié.')
      }
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Résilier le contrat</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Le site <strong>{siteName}</strong> ne sera plus sous contrat
            {contract.contractNumber && <> (<strong>{contract.contractNumber}</strong>)</>}.
            Les visites planifiées après la résiliation sont retirées du planning ;
            celles déjà réalisées restent dans l'historique.
          </p>

          <div className="ct-term-opts">
            {endFuture && (
              <label className="cat-track-row">
                <input type="radio" name="term-when" checked={when === 'end'} onChange={() => setWhen('end')} />
                <span>
                  <strong>À l'échéance, le {fmt(end)}</strong>
                  <span className="cat-track-hint">Pas de renouvellement : le contrat va au bout de la période en cours.</span>
                </span>
              </label>
            )}
            <label className="cat-track-row">
              <input type="radio" name="term-when" checked={when === 'date'} onChange={() => setWhen('date')} />
              <span>
                <strong>À une date précise</strong>
                {when === 'date' && (
                  <input type="date" className="form-input form-input--plain" style={{ marginTop: 6, maxWidth: 180 }}
                    value={date} onChange={e => setDate(e.target.value)} />
                )}
              </span>
            </label>
            <label className="cat-track-row">
              <input type="radio" name="term-when" checked={when === 'now'} onChange={() => setWhen('now')} />
              <span>
                <strong>Immédiatement</strong>
                <span className="cat-track-hint">Le contrat passe « Résilié » dès maintenant.</span>
              </span>
            </label>
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Motif <span className="form-label-opt">(optionnel)</span></label>
            <input className="form-input form-input--plain" value={reason}
              onChange={e => setReason(e.target.value)} placeholder="ex. Changement de prestataire" />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={confirm} disabled={loading}>
              {loading ? <span className="login-btn-spinner" />
                : when === 'now' ? 'Résilier maintenant' : 'Programmer la résiliation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
