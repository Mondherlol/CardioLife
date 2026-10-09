import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { toast } from 'react-toastify'
import { terminateContract } from '../api/contracts'
import { formatApiError } from './siteHelpers'

/**
 * Sortie du site de son contrat : le contrat passe « résilié » et ses visites
 * encore à faire quittent le planning. Le contrat reste consultable.
 */
export default function TerminateContractConfirm({ contract, siteName, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function confirm() {
    setLoading(true)
    try {
      const res = await terminateContract(contract._id)
      const n = res?.removedControls || 0
      toast.success(n
        ? `Contrat retiré · ${n} visite${n > 1 ? 's' : ''} planifiée${n > 1 ? 's' : ''} annulée${n > 1 ? 's' : ''}.`
        : 'Contrat retiré.')
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Retirer le contrat</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Le site <strong>{siteName}</strong> ne sera plus sous contrat : le
            contrat {contract.contractNumber && <strong>{contract.contractNumber}</strong>} passe
            en « Résilié » et ses visites planifiées sont retirées du planning.
            Les visites déjà réalisées restent dans l'historique.
          </p>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={confirm} disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Retirer le contrat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
