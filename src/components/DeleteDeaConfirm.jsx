import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { toast } from 'react-toastify'
import { deleteDea } from '../api/sites'
import { formatApiError } from './siteHelpers'

/**
 * Retrait d'un DEA de son site — partagé par la liste des sites du client et
 * par la fiche du site.
 *
 * onDone reçoit le site mis à jour renvoyé par l'API.
 */
export default function DeleteDeaConfirm({ site, dea, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function confirm() {
    setLoading(true)
    try {
      const updated = await deleteDea(site._id, dea._id)
      toast.success('DEA retiré du site.')
      onDone(updated)
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Retirer le DEA</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Retirer le DEA <strong>{dea.deviceType || 'sans type'}</strong>
            {dea.serialNumber && <> (n° {dea.serialNumber})</>} du site <strong>{site.name}</strong> ?
            {' '}Ses batteries et électrodes seront également supprimées.
          </p>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={confirm} disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Retirer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
