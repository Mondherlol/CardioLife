import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Wrench, AlertTriangle, CheckCircle2, XCircle, Building2, Hash,
  Zap, BatteryMedium, HeartPulse, User, Trash2, Package,
} from 'lucide-react'
import {
  getReplacements, updateReplacement, deleteReplacement,
  REPLACEMENT_STATUSES, replacementKind, replacementStatus, replacementReason,
} from '../api/replacements'
import { useLoadingBar } from '../hooks/useLoadingBar'

const KIND_ICONS = { dae: HeartPulse, batterie: BatteryMedium, electrodes: Zap }

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* Confirmation avant de solder une demande : le geste touche au stock. */
function TreatModal({ request, onClose, onDone }) {
  const [serial,  setSerial]  = useState(request.replacementItem?.serialNumber
    || request.replacementItem?.lotNumber || '')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const isLot = replacementKind(request.kind).field === 'lotNumber'

  async function confirm() {
    setLoading(true)
    setError('')
    try {
      const saved = await updateReplacement(request._id, {
        status: 'remplace',
        replacementSerial: serial.trim() || undefined,
      })
      toast.success('Remplacement enregistré.')
      onDone(saved)
    } catch (err) {
      setError(err.message || 'Erreur.')
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><CheckCircle2 size={16} /> Marquer comme remplacé</h2>
          <button className="modal-close" onClick={onClose}><XCircle size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            {replacementKind(request.kind).label} sur <strong>{request.site?.name}</strong>
            {request.deaLabel && <> — {request.deaLabel}</>}
          </p>
          <div className="form-group">
            <label className="form-label">{isLot ? 'N° de lot posé' : 'N° de série posé'}</label>
            <input className="form-input form-input--plain" value={serial}
              onChange={e => setSerial(e.target.value)}
              placeholder="Laisser vide pour utiliser l'article réservé" />
            <p className="form-hint">
              L'article correspondant passera en « installé » et sortira du stock.
            </p>
          </div>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--primary" onClick={confirm} disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Toutes les demandes de remplacement, tous clients confondus.
 *
 * Le tri met les demandes ouvertes devant : la page sert à traiter ce qui
 * attend, l'historique n'est qu'une conséquence.
 */
export default function ReplacementsPage({ embedded = false }) {
  const navigate = useNavigate()
  const [list,    setList]    = useState([])
  const [summary, setSummary] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('a_remplacer')
  const [treating, setTreating] = useState(null)

  useLoadingBar(loading)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getReplacements(filter === 'tous' ? {} : { status: filter })
      setList(res.data || [])
      setSummary(res.summary || {})
    } catch (err) {
      toast.error(err.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  function replaceRow(saved) {
    setList(l => filter === 'a_remplacer'
      ? l.filter(r => r._id !== saved._id)     // la demande quitte la vue « ouvertes »
      : l.map(r => (r._id === saved._id ? saved : r)))
    setTreating(null)
    setSummary(s => ({
      ...s,
      a_remplacer: Math.max(0, (s.a_remplacer || 1) - 1),
      remplace:    (s.remplace || 0) + 1,
    }))
  }

  async function cancel(r) {
    if (!window.confirm('Annuler cette demande ? L\'article réservé retourne en stock.')) return
    try {
      const saved = await updateReplacement(r._id, { status: 'annule' })
      setList(l => filter === 'a_remplacer' ? l.filter(x => x._id !== r._id)
        : l.map(x => (x._id === r._id ? saved : x)))
      toast.success('Demande annulée.')
    } catch (err) { toast.error(err.message || 'Erreur.') }
  }

  async function destroy(r) {
    if (!window.confirm('Supprimer définitivement cette demande ?')) return
    try {
      await deleteReplacement(r._id)
      setList(l => l.filter(x => x._id !== r._id))
      toast.success('Demande supprimée.')
    } catch (err) { toast.error(err.message || 'Erreur.') }
  }

  const TABS = [
    { id: 'a_remplacer', label: 'À traiter', count: summary.a_remplacer || 0 },
    { id: 'remplace',    label: 'Remplacés', count: summary.remplace    || 0 },
    { id: 'annule',      label: 'Annulés',   count: summary.annule      || 0 },
    { id: 'tous',        label: 'Tous' },
  ]

  return (
    <div className={embedded ? 'mt-tab-panel' : 'page-content'}>
      <div className="page-header">
        <div>
          {!embedded && <h1 className="page-title"><Wrench size={20} /> Remplacements</h1>}
          <p className="page-subtitle">
            Pièces signalées défectueuses sur le terrain et suite qui leur est donnée.
          </p>
        </div>
      </div>

      <div className="rep-tabs">
        {TABS.map(t => (
          <button key={t.id} type="button"
            className={`rep-tab${filter === t.id ? ' rep-tab--on' : ''}`}
            onClick={() => setFilter(t.id)}>
            {t.label}
            {t.count > 0 && <span className="rep-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : list.length === 0 ? (
        <div className="ctrl-empty">
          <Wrench size={40} color="var(--gray-300)" />
          <p>{filter === 'a_remplacer'
            ? 'Aucune demande en attente. Tout est à jour.'
            : 'Aucune demande dans cette catégorie.'}</p>
        </div>
      ) : (
        <div className="rep-list">
          {list.map(r => {
            const Icon = KIND_ICONS[r.kind] || Wrench
            const st   = replacementStatus(r.status)
            const open = r.status === 'a_remplacer'
            return (
              <div key={r._id} className={`rep-card rep-card--${r.status}`}>
                <div className="rep-card-icon"><Icon size={17} /></div>

                <div className="rep-card-main">
                  <div className="rep-card-head">
                    <span className="rep-card-title">{replacementKind(r.kind).label}</span>
                    <span className={`rep-badge rep-badge--${st.tone}`}>{st.label}</span>
                    <span className="rep-card-reason">{replacementReason(r.reason).label}</span>
                  </div>

                  <div className="rep-card-lines">
                    {r.site?._id && (
                      <button type="button" className="rep-card-line rep-card-link"
                        onClick={() => navigate(`/sites/${r.site._id}`)}>
                        <Building2 size={11} /> {r.site.name}
                        {r.client?.name && <> · {r.client.name}</>}
                      </button>
                    )}
                    {r.deaLabel && <span className="rep-card-line"><HeartPulse size={11} /> {r.deaLabel}</span>}
                    <span className="rep-card-line">
                      <Hash size={11} /> {r.serialNumber || r.lotNumber || '—'}
                      {r.faultyItem && <span className="rep-card-tag">connu du stock</span>}
                    </span>
                    {(r.product?.name || r.productName) && (
                      <span className="rep-card-line"><Package size={11} /> {r.product?.name || r.productName}</span>
                    )}
                    {r.replacementSerial && (
                      <span className="rep-card-line rep-card-line--ok">
                        <CheckCircle2 size={11} /> Remplacé par {r.replacementSerial}
                      </span>
                    )}
                    {open && r.replacementItem && (
                      <span className="rep-card-line rep-card-line--ok">
                        <Package size={11} /> Remplaçant réservé :{' '}
                        {r.replacementItem.serialNumber || r.replacementItem.lotNumber}
                      </span>
                    )}
                    <span className="rep-card-line">
                      <User size={11} /> {r.requestedByName || r.requestedBy?.fullName || '—'}
                      {' · '}{formatDate(r.createdAt)}
                    </span>
                  </div>

                  {r.notes && <p className="rep-card-note">« {r.notes} »</p>}
                </div>

                <div className="rep-card-actions">
                  {open && (
                    <>
                      <button className="btn btn--primary btn--sm" onClick={() => setTreating(r)}>
                        <CheckCircle2 size={13} /> Remplacé
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => cancel(r)}>
                        Annuler
                      </button>
                    </>
                  )}
                  <button className="btn btn--ghost btn--sm" title="Supprimer"
                    onClick={() => destroy(r)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {treating && (
        <TreatModal
          request={treating}
          onClose={() => setTreating(null)}
          onDone={replaceRow}
        />
      )}
    </div>
  )
}
