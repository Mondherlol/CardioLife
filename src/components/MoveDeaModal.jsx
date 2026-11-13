import { useState, useEffect } from 'react'
import { X, AlertTriangle, Building2, Plus, ArrowRightLeft } from 'lucide-react'
import { toast } from 'react-toastify'
import { lookupSites, moveDea } from '../api/sites'
import { formatApiError } from './siteHelpers'

/**
 * Change un DEA de site, au sein du même client — partagé par la liste des
 * sites du client et par la fiche du site.
 *
 * Props :
 *  site         - site actuel du DEA
 *  dea          - appareil à déplacer
 *  clientId     - client du site (pour lister ses autres sites)
 *  initialTargetId - site d'arrivée présélectionné (juste créé par duplication)
 *  onCreateSite - () => void, propose de créer le site d'arrivée (optionnel)
 *  onClose      - () => void
 *  onDone       - ({ source, target }) => void
 */
export default function MoveDeaModal({ site, dea, clientId, initialTargetId, onCreateSite, onClose, onDone }) {
  const [sites,   setSites]   = useState(null)
  const [target,  setTarget]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    lookupSites(clientId)
      .then(list => {
        const others = (Array.isArray(list) ? list : [])
          .filter(s => String(s._id) !== String(site._id))
        setSites(others)
        if (initialTargetId) {
          setTarget(others.find(s => String(s._id) === String(initialTargetId)) || null)
        }
      })
      .catch(err => { setSites([]); setError(formatApiError(err)) })
  }, [clientId, site._id, initialTargetId])

  async function confirm() {
    if (!target) return
    setError('')
    setLoading(true)
    try {
      const res = await moveDea(site._id, dea._id, target._id)
      toast.success(res.message || 'DEA déplacé.')
      // Ce que le déplacement laisse à vérifier (tarif, contrat sans appareil…).
      ;(res.notes || []).forEach(n => toast.info(n, { autoClose: 8000 }))
      onDone(res)
    } catch (err) {
      setError(formatApiError(err))
      setLoading(false)
    }
  }

  const label = [dea.deviceType, dea.serialNumber && `n° ${dea.serialNumber}`].filter(Boolean).join(' · ') || 'DEA'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Changer de site</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="pick-site-hint">
            Déplacer <strong>{label}</strong> de <strong>{site.name}</strong> vers :
          </p>

          {sites === null ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : sites.length === 0 ? (
            <p className="cd-empty-hint" style={{ padding: 0 }}>
              Ce client n'a pas d'autre site.
            </p>
          ) : (
            <div className="pick-site-list">
              {sites.map(s => (
                <button key={s._id} type="button"
                  className={`pick-site-item${target?._id === s._id ? ' pick-site-item--on' : ''}`}
                  aria-pressed={target?._id === s._id}
                  onClick={() => setTarget(s)}>
                  <Building2 size={15} />
                  <span className="pick-site-item-main">
                    <span className="pick-site-item-name">{s.name}</span>
                    {(s.address?.street || s.address?.city) && (
                      <span className="pick-site-item-addr">
                        {[s.address?.street, s.address?.city].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="pick-site-item-count">{s.deas?.length || 0} DEA</span>
                </button>
              ))}
            </div>
          )}

          {onCreateSite && (
            <button type="button" className="pick-site-new" onClick={onCreateSite}>
              <Plus size={14} /> Créer le site d'arrivée (copie de « {site.name} »)
            </button>
          )}

          <p className="cd-empty-hint" style={{ padding: 0 }}>
            L'appareil garde son historique, ses batteries, électrodes et armoire.
            Les visites déjà faites restent sur « {site.name} » ; les prochains
            contrôles suivent le calendrier du site d'arrivée.
          </p>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--primary" onClick={confirm} disabled={!target || loading}>
              {loading ? <span className="login-btn-spinner" /> : <><ArrowRightLeft size={14} /> Déplacer</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
