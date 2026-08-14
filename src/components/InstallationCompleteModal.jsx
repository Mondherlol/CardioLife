import { useState } from 'react'
import { X, AlertTriangle, CheckCircle2, HeartPulse, MapPin, Hash } from 'lucide-react'
import { toast } from 'react-toastify'
import { completeInstallation, updateInstallation } from '../api/installations'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Compte rendu de pose par le technicien.
 *
 * Ce qu'il saisit ici devient la vérité du parc : l'emplacement et le numéro de
 * série renseignés se retrouvent sur la fiche du site, sur celle du client et
 * sur l'exemplaire en stock, qui quitte l'entrepôt.
 *
 * Une pose qui s'est mal passée n'est pas validée : elle reste planifiée avec
 * la remarque du technicien, pour que le bureau la reprenne.
 *
 * Props :
 *  installation - la pose ({ _id, deviceType, serialNumber, location, … })
 *  onClose - () => void
 *  onDone  - (installation) => void
 */
export default function InstallationCompleteModal({ installation, onClose, onDone }) {
  const [form, setForm] = useState({
    serialNumber: installation.serialNumber || '',
    location:     installation.location     || '',
    date:         todayStr(),
    notes:        '',
  })
  const [wentWell, setWentWell] = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (wentWell && !form.serialNumber.trim()) {
      setError('Le numéro de série de l\'appareil posé est requis.')
      return
    }
    if (wentWell && !form.location.trim()) {
      setError('Indiquez où l\'appareil a été posé.')
      return
    }
    if (!wentWell && !form.notes.trim()) {
      setError('Décrivez ce qui a empêché la pose.')
      return
    }

    setSaving(true)
    try {
      if (wentWell) {
        const saved = await completeInstallation(installation._id, {
          serialNumber:     form.serialNumber.trim(),
          location:         form.location.trim(),
          installationDate: form.date,
          notes:            form.notes.trim() || undefined,
        })
        toast.success('Installation validée.')
        onDone?.(saved)
      } else {
        // La pose reste à faire : seule la remarque remonte au bureau.
        const saved = await updateInstallation(installation._id, {
          notes: [installation.notes, `⚠ Pose non réalisée : ${form.notes.trim()}`]
            .filter(Boolean).join('\n'),
        })
        toast.info('Signalement enregistré — la pose reste planifiée.')
        onDone?.(saved)
      }
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><HeartPulse size={16} /> Compte rendu de pose</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <p className="dea-modal-site">
            {installation.clientName} · <strong>{installation.deviceType || 'DAE'}</strong>
          </p>

          <div className="form-group">
            <label className="form-label">La pose s'est-elle bien passée ? *</label>
            <div className="rep-status-row">
              <button type="button"
                className={`rep-status${wentWell ? ' rep-status--on' : ''}`}
                onClick={() => setWentWell(true)}>
                <strong>Oui, appareil posé</strong>
                <span>L'appareil est en place et opérationnel.</span>
              </button>
              <button type="button"
                className={`rep-status${!wentWell ? ' rep-status--on' : ''}`}
                onClick={() => setWentWell(false)}>
                <strong>Non, pose impossible</strong>
                <span>La pose reste planifiée, le bureau est alerté.</span>
              </button>
            </div>
          </div>

          {wentWell && (
            <>
              <div className="form-group">
                <label className="form-label"><Hash size={12} /> N° de série posé *</label>
                <input className="form-input form-input--plain" value={form.serialNumber}
                  onChange={e => set('serialNumber', e.target.value)}
                  placeholder="Numéro lu sur l'appareil" />
                <p className="form-hint">
                  Il sera reporté sur la fiche du site et sortira l'appareil du stock.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label"><MapPin size={12} /> Emplacement exact *</label>
                <input className="form-input form-input--plain" value={form.location}
                  onChange={e => set('location', e.target.value)}
                  placeholder="Ex : Hall d'accueil, à droite de l'entrée" />
              </div>

              <div className="form-group">
                <label className="form-label">Date de pose</label>
                <input type="date" className="form-input form-input--plain"
                  value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">
              Remarques {!wentWell && <span style={{ color: 'var(--red-500)' }}>*</span>}
            </label>
            <textarea className="form-input form-input--plain form-textarea" rows={3}
              value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder={wentWell
                ? 'Observations sur la pose, le site, l\'accès…'
                : 'Ce qui a empêché la pose…'} />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className={`btn ${wentWell ? 'btn--primary' : 'btn--danger'}`} disabled={saving}>
              {saving ? <span className="login-btn-spinner" />
                : wentWell ? <><CheckCircle2 size={14} /> Valider la pose</> : 'Signaler'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
