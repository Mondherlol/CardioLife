import { useState } from 'react'
import { X, AlertTriangle, Archive, CheckCircle2, BatteryWarning, HelpCircle, Wrench } from 'lucide-react'
import { toast } from 'react-toastify'
import { updateDea } from '../api/sites'
import { ARMOIRE_MODELS, toDateInput, formatApiError } from './siteHelpers'

const today = () => toDateInput(new Date())

const PILES_CHOICES = [
  { value: 'ok',          label: 'En état',     Icon: CheckCircle2,   cls: 'choice-btn--on-green' },
  { value: 'a_remplacer', label: 'À remplacer', Icon: BatteryWarning, cls: 'choice-btn--on-red' },
  { value: '',            label: 'Non contrôlées', Icon: HelpCircle, cls: '' },
]

/**
 * Armoire d'un DAE et piles de son alarme, depuis la fiche client.
 *
 * Les armoires sont sonores : leurs piles font partie du contrôle. Le
 * technicien les renseigne pendant la visite ; cette fenêtre sert à corriger ou
 * à consigner un remplacement fait hors visite. « Piles remplacées aujourd'hui »
 * remet l'état à « en état » et date le remplacement d'un seul geste.
 */
export default function ArmoireModal({ site, dea, onClose, onSaved }) {
  const arm = dea?.armoire || {}
  const [form, setForm] = useState({
    model:           arm.model || '',
    pilesStatus:     arm.pilesStatus || '',
    pilesCheckedAt:  toDateInput(arm.pilesCheckedAt),
    pilesReplacedAt: toDateInput(arm.pilesReplacedAt),
    notes:           arm.notes || '',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  /* Un état choisi se date du jour s'il ne l'était pas : sans date, la fiche
     ne dirait pas de quand date le constat. */
  function setPiles(value) {
    setForm(f => ({
      ...f,
      pilesStatus:    value,
      pilesCheckedAt: value && !f.pilesCheckedAt ? today() : f.pilesCheckedAt,
    }))
  }

  function markReplaced() {
    const d = today()
    setForm(f => ({ ...f, pilesStatus: 'ok', pilesReplacedAt: d, pilesCheckedAt: d }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const armoire = {
        model:           form.model.trim(),
        pilesStatus:     form.pilesStatus,
        pilesCheckedAt:  form.pilesCheckedAt || null,
        pilesReplacedAt: form.pilesReplacedAt || null,
        notes:           form.notes.trim(),
      }
      const updated = await updateDea(site._id, dea._id, { armoire })
      toast.success('Armoire mise à jour.')
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
          <h2 className="modal-title"><Archive size={16} /> Armoire du DEA</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="dea-modal-site">
            <strong>{dea.deviceType || 'DEA'}</strong>
            {dea.serialNumber && <span className="dea-sn">{dea.serialNumber}</span>}
            <span className="form-hint" style={{ margin: 0 }}>{site.name}{dea.location ? ` · ${dea.location}` : ''}</span>
          </div>

          <div className="form-group">
            <label className="form-label">Modèle d'armoire</label>
            <input className="form-input form-input--plain" value={form.model}
              onChange={e => set('model', e.target.value)} placeholder="Ex : AIVIA 100" />
            <div className="arm-presets">
              {ARMOIRE_MODELS.map(m => (
                <button key={m} type="button"
                  className={`fiche-preset-chip${form.model === m ? ' fiche-preset-chip--active' : ''}`}
                  onClick={() => set('model', form.model === m ? '' : m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Piles de l'alarme</label>
            <div className="choice-row">
              {PILES_CHOICES.map(({ value, label, Icon, cls }) => (
                <button key={value || 'none'} type="button"
                  className={`choice-btn${form.pilesStatus === value ? ` choice-btn--on ${cls}` : ''}`}
                  onClick={() => setPiles(value)}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--ghost btn--sm arm-replaced-btn" onClick={markReplaced}>
              <Wrench size={13} /> Piles remplacées aujourd'hui
            </button>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Dernier contrôle des piles</label>
              <input type="date" className="form-input form-input--plain" value={form.pilesCheckedAt}
                onChange={e => set('pilesCheckedAt', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Dernier remplacement</label>
              <input type="date" className="form-input form-input--plain" value={form.pilesReplacedAt}
                onChange={e => set('pilesReplacedAt', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Note</label>
            <textarea className="form-input form-input--plain form-textarea" rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)} placeholder="Type de piles, accès à l'armoire…" />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
