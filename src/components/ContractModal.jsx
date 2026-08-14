import { useEffect, useState } from 'react'
import { X, AlertTriangle, Wand2, Info } from 'lucide-react'
import { toast } from 'react-toastify'
import {
  createContract, updateContract, getNextNumber, CONTRACT_STATUSES,
} from '../api/contracts'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

function toDateInput(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function addYear(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Création / édition du contrat de maintenance d'un site.
 *
 * Le contrat couvre un site : chaque site a son parc et son propre calendrier
 * de visites. Il n'y a pas de formulaire de contenu — les DAE couverts sont
 * ceux posés sur le site, et les contrôles sont toujours semestriels. Restent
 * le numéro, la période et le statut.
 *
 * Props :
 *  site     - { _id, name, deas } — requis en création
 *  contract - contrat existant (null → création)
 *  onClose  - () => void
 *  onSaved  - (contrat) => void
 */
export default function ContractModal({ site, contract, onClose, onSaved }) {
  const isEdit = !!contract?._id
  const deaCount = site?.deas?.length ?? null

  const [number, setNumber] = useState(contract?.contractNumber || '')
  const [start,  setStart]  = useState(toDateInput(contract?.startDate) || new Date().toISOString().slice(0, 10))
  const [end,    setEnd]    = useState(toDateInput(contract?.endDate)   || addYear())
  const [status, setStatus] = useState(contract?.status || 'actif')
  const [notes,  setNotes]  = useState(contract?.notes || '')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  /* Numéro proposé d'office en création : l'utilisateur n'a qu'à valider. */
  useEffect(() => {
    if (isEdit || number) return
    getNextNumber().then(d => setNumber(d.number)).catch(() => {})
  }, [isEdit, number])

  async function regenerate() {
    try { setNumber((await getNextNumber()).number) }
    catch (err) { toast.error(formatApiError(err)) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (end && start && new Date(end) <= new Date(start)) {
      setError('La date de fin doit suivre la date de début.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const payload = {
        contractNumber: number.trim(),
        startDate: start || undefined,
        endDate:   end   || undefined,
        status,
        notes,
      }
      const saved = isEdit
        ? await updateContract(contract._id, payload)
        : await createContract({ ...payload, site: site._id })
      toast.success(isEdit ? 'Contrat mis à jour.' : 'Contrat créé — contrôles semestriels planifiés.')
      onSaved(saved)
    } catch (err) {
      setError(formatApiError(err))
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{isEdit ? 'Modifier le contrat' : 'Nouveau contrat de maintenance'}</h2>
            <div className="modal-subtitle">
              {contract?.siteName || contract?.site?.name || site?.name}
              {(contract?.clientName || site?.client?.name) &&
                ` · ${contract?.clientName || site?.client?.name}`}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label">Numéro de contrat</label>
            <div className="ct-number-row">
              <input
                className="form-input form-input--plain"
                value={number}
                onChange={e => setNumber(e.target.value)}
                placeholder="CT-2026-0001"
                autoFocus
              />
              <button type="button" className="btn btn--ghost btn--sm" onClick={regenerate}
                title="Générer un numéro automatiquement">
                <Wand2 size={13} /> Générer
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Début</label>
              <input type="date" className="form-input form-input--plain"
                value={start}
                onChange={e => {
                  setStart(e.target.value)
                  // La fin suit le début tant qu'elle n'a pas été fixée à la main.
                  if (!isEdit) setEnd(addYear(e.target.value))
                }} />
            </div>
            <div className="form-group">
              <label className="form-label">Échéance</label>
              <input type="date" className="form-input form-input--plain"
                value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>

          {isEdit && (
            <div className="form-group">
              <label className="form-label">Statut</label>
              <select className="form-input form-input--plain" value={status}
                onChange={e => setStatus(e.target.value)}>
                {CONTRACT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes <span className="form-label-opt">(optionnel)</span></label>
            <textarea className="form-input form-input--plain form-textarea" rows={2}
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Conditions particulières…" />
          </div>

          <div className="ct-auto-note">
            <Info size={14} />
            <div>
              Les <strong>DAE couverts</strong> sont ceux posés sur ce site
              {deaCount != null && <> — <strong>{deaCount} appareil{deaCount !== 1 ? 's' : ''}</strong> aujourd'hui</>} :
              rien à saisir. Les <strong>contrôles sont semestriels</strong> : deux par an, le second valant
              contrôle annuel, planifiés automatiquement sur la période.
            </div>
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Créer le contrat'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
