import { useRef, useState } from 'react'
import { X, AlertTriangle, Upload, Trash2, ImagePlus } from 'lucide-react'
import { toast } from 'react-toastify'
import { updateClient, uploadClientLogo, deleteClientLogo, clientLogoUrl } from '../api/clients'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const MAX_SIZE = 5 * 1024 * 1024

/**
 * Édition de l'identité du client : nom et image.
 *
 * L'image part immédiatement (elle a sa propre route), le nom est enregistré à
 * la validation du formulaire. Le contrat se gère depuis le bandeau de la fiche.
 *
 * Props :
 *  client  - client à modifier
 *  onClose - () => void
 *  onSaved - (client) => void — appelé à chaque changement enregistré
 */
export default function ClientHeaderModal({ client, onClose, onSaved }) {
  const fileRef = useRef(null)

  const [name,     setName]     = useState(client.name || '')
  const [logo,     setLogo]     = useState(client.logo || null)
  const [preview,  setPreview]  = useState(null)   // aperçu local pendant l'envoi
  const [uploading, setUploading] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function pickLogo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) { setError('Le fichier doit être une image.'); return }
    if (file.size > MAX_SIZE)            { setError('Image trop lourde (5 Mo maximum).'); return }

    setError('')
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const updated = await uploadClientLogo(client._id, file)
      setLogo(updated.logo)
      onSaved(updated)
      toast.success('Image mise à jour.')
    } catch (err) {
      setError(formatApiError(err))
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }

  async function removeLogo() {
    setError('')
    setUploading(true)
    try {
      const updated = await deleteClientLogo(client._id)
      setLogo(null)
      setPreview(null)
      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Le statut contractuel n'est plus un réglage : il découle des contrats du
      // client, et se pilote depuis le bandeau de sa fiche.
      const updated = await updateClient(client._id, { name: name.trim() })
      toast.success('Client mis à jour.')
      onSaved(updated)
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  const imageSrc = preview || (logo ? clientLogoUrl(logo) : null)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Modifier le client</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">

          {/* ── Image ── */}
          <div className="logo-edit">
            <div className={`logo-edit-preview${uploading ? ' logo-edit-preview--busy' : ''}`}>
              {imageSrc
                ? <img src={imageSrc} alt="" />
                : <span className="logo-edit-initials">{initials(name)}</span>}
              {uploading && <span className="logo-edit-spinner"><span className="spinner" /></span>}
            </div>

            <div className="logo-edit-actions">
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {logo ? <><Upload size={13} /> Remplacer</> : <><ImagePlus size={13} /> Ajouter une image</>}
              </button>
              {logo && (
                <button type="button" className="btn btn--ghost btn--sm logo-edit-remove"
                  onClick={removeLogo} disabled={uploading}>
                  <Trash2 size={13} /> Retirer
                </button>
              )}
              <p className="form-hint">JPG, PNG ou SVG · 5 Mo maximum</p>
            </div>

            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickLogo} />
          </div>

          {/* ── Nom ── */}
          <div className="form-group">
            <label className="form-label">Nom du client *</label>
            <input
              className="form-input form-input--plain"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex : Clinique du Lac"
              autoFocus
              required
            />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !name.trim()}>
              {loading ? <span className="login-btn-spinner" /> : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
