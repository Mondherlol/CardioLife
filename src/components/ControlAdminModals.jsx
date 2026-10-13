import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import { X, Trash2, PauseCircle, CalendarCheck, History, AlertTriangle, Repeat } from 'lucide-react'
import {
  deleteIntervention, setInterventionAttente, getInterventions, getDeletedInterventions, setControlType,
} from '../api/interventions'
import { CONTROL_LABELS, fmtDay } from '../lib/scheduledControls'

const PERIODIC = ['semestriel', 'annuel']
const otherType = t => (t === 'annuel' ? 'semestriel' : 'annuel')

/**
 * Contrôles à venir du même site, après `iv` : ceux que le réalignement
 * touchera. Avec le type qu'ils prendraient si `newType` est retenu.
 */
export function useFollowingControls(iv) {
  const [following, setFollowing] = useState([])
  const clientId = iv?.client?._id || iv?.client
  const siteId   = String(iv?.site?._id || iv?.site || '')
  useEffect(() => {
    if (!clientId || !siteId) { setFollowing([]); return }
    const ref = new Date(iv.completedDate || iv.scheduledDate)
    getInterventions({ client: clientId })
      .then(list => setFollowing((Array.isArray(list) ? list : [])
        .filter(c => c._id !== iv._id && String(c.site?._id || c.site) === siteId
          && c.status !== 'termine' && PERIODIC.includes(c.controlType)
          && new Date(c.scheduledDate) > ref)
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))))
      .catch(() => setFollowing([]))
  }, [clientId, siteId, iv?._id]) // eslint-disable-line react-hooks/exhaustive-deps
  return following
}

/** Aperçu du réalignement : le type que chaque contrôle suivant prendrait. */
export function RealignPreview({ following, newType }) {
  if (!following.length) return <p className="form-hint">Aucun contrôle à venir après celui-ci sur ce site.</p>
  let expected = otherType(newType)
  return (
    <ul className="ct-realign-list">
      {following.map(c => {
        const to = expected
        expected = otherType(expected)
        const changes = c.controlType !== to
        return (
          <li key={c._id} className={changes ? 'ct-realign--change' : ''}>
            {fmtDay(c.scheduledDate)} : {CONTROL_LABELS[c.controlType]}
            {changes ? <> → <strong>{CONTROL_LABELS[to]}</strong></> : ' (inchangé)'}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Corriger le type d'un contrôle périodique — réalisé ou à venir. Un annuel
 * fait à la place d'un semestriel, un fichier repris de travers : l'équipe le
 * dit, et la suite du site peut reprendre l'alternance à partir de là.
 */
export function ControlTypeModal({ iv, onClose, onDone }) {
  const [type,    setType]    = useState(iv.controlType)
  const [realign, setRealign] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const following = useFollowingControls(iv)

  async function submit() {
    setSaving(true)
    setError('')
    try {
      const { intervention, realigned } = await setControlType(iv._id, type, realign)
      toast.success(`Type corrigé${realigned ? ` — ${realigned} contrôle${realigned > 1 ? 's' : ''} suivant${realigned > 1 ? 's' : ''} réaligné${realigned > 1 ? 's' : ''}` : ''}.`)
      onDone(intervention)
    } catch (err) {
      setError(err.message || 'Correction impossible.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><Repeat size={16} /> Corriger le type du contrôle</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>
            Contrôle du {fmtDay(iv.completedDate || iv.scheduledDate)}
            {iv.status === 'termine' ? ' (réalisé)' : ''}.
          </p>
          <div className="ct-type-choice">
            {PERIODIC.map(t => (
              <label key={t} className={`bi-nature${type === t ? ' bi-nature--on' : ''}`}>
                <input type="radio" name="ct-type" checked={type === t} onChange={() => setType(t)} />
                {CONTROL_LABELS[t]}
              </label>
            ))}
          </div>

          <label className="sp-reset-opt" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={realign} onChange={e => setRealign(e.target.checked)} />
            <span>Réaligner les contrôles suivants du site (alternance semestriel / annuel)</span>
          </label>
          {realign && <RealignPreview following={following} newType={type} />}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="button" className="btn btn--primary" onClick={submit}
              disabled={saving || (type === iv.controlType && !realign)}>
              {saving ? <span className="spinner spinner--sm" /> : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Saisie d'un motif, commune à la suppression et à la mise en attente. */
function MotifModal({ title, icon: Icon, intro, placeholder, required, confirmLabel, danger, onClose, onConfirm }) {
  const [motif,  setMotif]  = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function submit(e) {
    e.preventDefault()
    if (required && !motif.trim()) return setError('Le motif est obligatoire.')
    setSaving(true)
    setError('')
    try {
      await onConfirm(motif.trim())
    } catch (err) {
      setError(err.message || 'Action impossible.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><Icon size={16} /> {title}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <p style={{ marginTop: 0 }}>{intro}</p>
          <div className="form-group">
            <label className="form-label">Motif{required ? ' *' : ''}</label>
            <textarea className="form-input form-input--plain" rows={3} autoFocus value={motif}
              placeholder={placeholder} onChange={e => setMotif(e.target.value)} />
          </div>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Suppression motivée d'une intervention ponctuelle ou d'un contrôle hors contrat. */
export function DeleteInterventionModal({ iv, onClose, onDeleted }) {
  const what = CONTROL_LABELS[iv.controlType] || 'Intervention'
  return (
    <MotifModal
      title={`Supprimer — ${what}`}
      icon={Trash2}
      intro={<>Supprimer <strong>{what.toLowerCase()}{iv.clientName ? ` — ${iv.clientName}` : ''}</strong> du {fmtDay(iv.scheduledDate)} ?
        Elle disparaît du planning ; une copie est gardée dans l'historique des suppressions.</>}
      placeholder="ex. Créée en double, visite annulée par le client…"
      required
      danger
      confirmLabel="Supprimer"
      onClose={onClose}
      onConfirm={async motif => {
        await deleteIntervention(iv._id, motif)
        toast.success(`${what} supprimée.`)
        onDeleted()
      }}
    />
  )
}

/** Mise en attente de RDV d'un contrôle du contrat. */
export function AttenteModal({ iv, onClose, onDone }) {
  return (
    <MotifModal
      title="Mettre en attente de RDV"
      icon={PauseCircle}
      intro={<>Le contrôle reste dû, mais quitte le calendrier : il apparaît dans
        « En attente de planification » jusqu'à ce qu'on le programme.</>}
      placeholder="ex. Client à rappeler en novembre, site fermé pour travaux…"
      confirmLabel="Mettre en attente"
      onClose={onClose}
      onConfirm={async motif => {
        const updated = await setInterventionAttente(iv._id, { enAttente: true, motif })
        toast.success('Contrôle mis en attente de RDV.')
        onDone(updated)
      }}
    />
  )
}

/**
 * Contrôles en attente de planification, du plus anciennement dû au plus
 * récent. « Programmer » ouvre la programmation sur ce contrôle précis.
 */
export function AttenteListModal({ onClose, onOpen, onSchedule, refreshKey }) {
  const [items,   setItems]   = useState(null)

  useEffect(() => {
    getInterventions({ enAttente: '1' })
      .then(list => setItems((Array.isArray(list) ? list : [])
        .filter(i => i.status !== 'termine')
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))))
      .catch(() => setItems([]))
  }, [refreshKey])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title">
            <PauseCircle size={16} /> En attente de planification{items ? ` (${items.length})` : ''}
          </h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {!items ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : items.length === 0 ? (
            <p className="plan-side-empty" style={{ padding: '24px 0', textAlign: 'center' }}>
              Aucun contrôle en attente.
            </p>
          ) : (
            <ul className="att-list">
              {items.map(iv => (
                <li key={iv._id} className="att-item">
                  <button type="button" className="att-main" onClick={() => onOpen(iv._id)}>
                    <span className="att-title">{iv.clientName || 'Client'}</span>
                    <span className="att-sub">
                      {CONTROL_LABELS[iv.controlType] || 'Contrôle'}{iv.siteName ? ` · ${iv.siteName}` : ''}
                      {' · prévu le '}{fmtDay(iv.scheduledDate)}
                    </span>
                    <span className="att-motif">
                      En attente depuis le {fmtDay(iv.attenteSince)}{iv.attenteMotif ? ` — ${iv.attenteMotif}` : ''}
                    </span>
                  </button>
                  {onSchedule && (
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => onSchedule(iv)}>
                      <CalendarCheck size={13} /> Programmer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

/** Historique des suppressions d'interventions (admin et superadmin). */
export function DeletionLogModal({ onClose }) {
  const [logs, setLogs] = useState(null)

  useEffect(() => {
    getDeletedInterventions().then(setLogs).catch(err => { toast.error(err.message); setLogs([]) })
  }, [])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><History size={16} /> Historique des suppressions</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {!logs ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : logs.length === 0 ? (
            <p className="plan-side-empty" style={{ padding: '24px 0', textAlign: 'center' }}>
              Aucune suppression.
            </p>
          ) : (
            <ul className="att-list">
              {logs.map(l => (
                <li key={l._id} className="att-item">
                  <div className="att-main">
                    <span className="att-title">{l.label || 'Intervention'}{l.clientName ? ` — ${l.clientName}` : ''}</span>
                    <span className="att-sub">
                      {l.siteName ? `${l.siteName} · ` : ''}
                      Supprimée le {new Date(l.deletedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                      {l.deletedByName ? ` par ${l.deletedByName}` : ''}
                    </span>
                    {l.reason && <span className="att-motif">Motif : {l.reason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}
