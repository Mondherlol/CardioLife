import { useState } from 'react'
import { X, AlertTriangle, Wrench, Zap, BatteryMedium, HeartPulse, Package } from 'lucide-react'
import { toast } from 'react-toastify'
import {
  createReplacement, REPLACEMENT_KINDS, REPLACEMENT_REASONS, replacementKind,
} from '../api/replacements'
import { useCatalogStock, stockOptionsFor, StockPicker, formatApiError } from './stockPickers'

const KIND_ICONS = { dae: HeartPulse, batterie: BatteryMedium, electrodes: Zap }

/* Catégorie du stock où chercher la pièce posée, selon l'élément remplacé. */
const KIND_CATEGORY = {
  dae:        'defibrillateurs',
  batterie:   'batteries',
  electrodes: 'electrodes',
}

/**
 * Signalement d'un élément défectueux depuis le terrain.
 *
 * Deux situations, un seul formulaire : la pièce est à remplacer (le technicien
 * n'avait pas de quoi la changer), ou elle l'a déjà été pendant la visite. Le
 * reste du formulaire est identique — seul le numéro du remplaçant s'ajoute.
 *
 * Props :
 *  site    - site concerné ({ _id, name, deas })
 *  deas    - appareils du site : [{ _id, deviceType, serialNumber, location }]
 *  dea     - appareil pré-sélectionné (optionnel)
 *  presetKind   - élément pré-sélectionné ('batterie' | 'electrodes' | 'dae')
 *  presetStatus - situation de départ ('remplace' quand la pièce vient d'être posée)
 *  intervention - contrôle d'où part le signalement (optionnel)
 *  onClose - () => void
 *  onSaved - (demande) => void
 */
export default function ReplacementModal({
  site, deas = [], dea, presetKind, presetStatus, intervention, onClose, onSaved,
}) {
  const [form, setForm] = useState({
    kind:   presetKind || 'batterie',
    status: presetStatus || 'a_remplacer',
    reason: 'defectueux',
    dea:    dea?._id || (deas.length === 1 ? deas[0]._id : ''),
    number: '',
    productName: '',
    replacementSerial: '',
    notes: '',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const cfg       = replacementKind(form.kind)
  const isLot     = cfg.field === 'lotNumber'
  const alreadyDone = form.status === 'remplace'
  const selectedDea = deas.find(d => String(d._id) === String(form.dea))

  /* La pièce posée se choisit dans le stock : c'est ce choix qui la sort de
     l'entrepôt. La saisie libre reste possible pour du matériel non suivi. */
  const { stock } = useCatalogStock(KIND_CATEGORY[form.kind] || 'batteries')
  const [pickedItem, setPickedItem] = useState(null)
  const stockOptions = stockOptionsFor(stock, { field: cfg.field })

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  /* Changer de type change ce qu'on identifie : le numéro saisi ne vaut plus. */
  function setKind(kind) {
    setForm(f => ({
      ...f,
      kind,
      // Un DEA défectueux se désigne par le numéro de l'appareil du parc.
      number: kind === 'dae' ? (selectedDea?.serialNumber || '') : '',
    }))
  }

  function pickDea(id) {
    const d = deas.find(x => String(x._id) === String(id))
    setForm(f => ({
      ...f,
      dea: id,
      number: f.kind === 'dae' ? (d?.serialNumber || '') : f.number,
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!form.number.trim()) {
      setError(isLot
        ? 'Indiquez le numéro de lot de l\'élément concerné.'
        : 'Indiquez le numéro de série de l\'élément concerné.')
      return
    }
    if (alreadyDone && !form.replacementSerial.trim()) {
      setError('Indiquez le numéro de la pièce posée en remplacement.')
      return
    }

    setLoading(true)
    try {
      const saved = await createReplacement({
        site:   site._id,
        dea:    form.dea || undefined,
        kind:   form.kind,
        status: form.status,
        reason: form.reason,
        [cfg.field]: form.number.trim(),
        productName: form.productName.trim(),
        replacementSerial: alreadyDone ? form.replacementSerial.trim() : undefined,
        notes: form.notes.trim(),
        intervention: intervention?._id || undefined,
      })
      toast.success(alreadyDone
        ? `Remplacement consigné — ${saved.replacementSerial || form.replacementSerial.trim()} posé.`
        : 'Demande de remplacement envoyée — rien n\'est déduit du stock.')
      onSaved?.(saved)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title"><Wrench size={16} /> Signaler un remplacement</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <p className="dea-modal-site">Site : <strong>{site.name}</strong></p>

          {/* Quoi : le choix commande tout le reste du formulaire. */}
          <div className="form-group">
            <label className="form-label">Élément concerné *</label>
            <div className="rep-kind-row">
              {REPLACEMENT_KINDS.map(k => {
                const Icon = KIND_ICONS[k.value] || Wrench
                return (
                  <button
                    key={k.value} type="button"
                    className={`rep-kind${form.kind === k.value ? ' rep-kind--on' : ''}`}
                    onClick={() => setKind(k.value)}
                  >
                    <Icon size={15} /> {k.label}
                  </button>
                )
              })}
            </div>
          </div>

          {deas.length > 0 && (
            <div className="form-group">
              <label className="form-label">
                Appareil {form.kind === 'dae' ? '*' : <span className="form-label-opt">(sur quel DEA)</span>}
              </label>
              <select className="form-input form-input--plain" value={form.dea}
                onChange={e => pickDea(e.target.value)}>
                <option value="">— Non précisé —</option>
                {deas.map(d => (
                  <option key={d._id} value={d._id}>
                    {[d.deviceType || 'DAE', d.serialNumber, d.location].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                {isLot ? 'N° de lot' : 'N° de série'} *
              </label>
              <input className="form-input form-input--plain" value={form.number}
                onChange={e => set('number', e.target.value)}
                placeholder={isLot ? 'Ex : L-2024-08' : 'Ex : B-88213'} />
              <p className="form-hint">
                S'il correspond à un article du stock, il passera automatiquement hors service.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Motif</label>
              <select className="form-input form-input--plain" value={form.reason}
                onChange={e => set('reason', e.target.value)}>
                {REPLACEMENT_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Modèle <span className="form-label-opt">(si le numéro est inconnu du stock)</span>
            </label>
            <input className="form-input form-input--plain" value={form.productName}
              onChange={e => set('productName', e.target.value)}
              placeholder="Ex : Batterie Zoll AED 3" />
          </div>

          {/* Demande ou constat : le seul embranchement du formulaire. */}
          <div className="form-group">
            <label className="form-label">Situation *</label>
            <div className="rep-status-row">
              <button type="button"
                className={`rep-status${!alreadyDone ? ' rep-status--on' : ''}`}
                onClick={() => set('status', 'a_remplacer')}>
                <strong>À remplacer</strong>
                <span>La pièce est défectueuse, le remplacement reste à faire.</span>
              </button>
              <button type="button"
                className={`rep-status${alreadyDone ? ' rep-status--on' : ''}`}
                onClick={() => set('status', 'remplace')}>
                <strong>Déjà remplacé</strong>
                <span>Le remplacement a été fait pendant la visite.</span>
              </button>
            </div>
          </div>

          {alreadyDone ? (
            <div className="form-group">
              <label className="form-label">
                Pièce posée <span className="form-label-opt">(choisie dans le stock)</span> *
              </label>
              <StockPicker
                items={stockOptions}
                value={pickedItem}
                field={cfg.field}
                onChange={it => {
                  setPickedItem(it)
                  set('replacementSerial', it?.[cfg.field] || it?.serialNumber || it?.lotNumber || '')
                }}
                onClear={() => { setPickedItem(null); set('replacementSerial', '') }}
                placeholder={`Rechercher un ${isLot ? 'n° de lot' : 'n° de série'} en stock…`}
              />
              <input className="form-input form-input--plain" style={{ marginTop: 6 }}
                value={form.replacementSerial}
                onChange={e => { setPickedItem(null); set('replacementSerial', e.target.value) }}
                placeholder={isLot ? 'ou saisir le n° de lot posé' : 'ou saisir le n° de série posé'} />
              <p className="form-hint">
                <Package size={11} /> L'article choisi passe en « installé » sur ce site
                et sort du stock. Un numéro inconnu du stock reste purement déclaratif.
              </p>
            </div>
          ) : (
            <p className="form-hint" style={{ marginTop: -4 }}>
              Un article disponible du même modèle sera réservé pour ce client, s'il y en a un.
            </p>
          )}

          <div className="form-group">
            <label className="form-label">Précisions</label>
            <textarea className="form-input form-input--plain form-textarea" rows={2}
              value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Ce qui a été constaté, où se trouve la pièce…" />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" />
                : alreadyDone ? 'Consigner le remplacement' : 'Envoyer la demande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
