import { useState, useEffect, useRef } from 'react'
import { X, AlertTriangle, Wrench, Zap, BatteryMedium, HeartPulse, Package } from 'lucide-react'
import { toast } from 'react-toastify'
import {
  createReplacement, REPLACEMENT_KINDS, REPLACEMENT_REASONS, replacementKind,
} from '../api/replacements'
import {
  useCatalogStock, stockOptionsFor, StockPicker, ProductPicker, formatApiError,
} from './stockPickers'
import { getProductCategories } from '../api/productCategories'
import { toDateInput } from './siteHelpers'

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
  site, deas = [], dea, presetKind, presetStatus, intervention, clientId, onClose, onSaved,
}) {
  /* Le client du site : une réservation faite pour lui reste posable ici, celle
     d'un autre client ne doit même pas apparaître. */
  const client = clientId || site?.client?._id || site?.client || null
  /* L'appareil visé à l'ouverture : celui qu'on a sous les yeux, ou l'unique
     du site. C'est lui qui porte le numéro de série d'un remplacement de DEA. */
  const openDea = dea || (deas.length === 1 ? deas[0] : null)

  const [form, setForm] = useState({
    kind:   presetKind || 'batterie',
    status: presetStatus || 'a_remplacer',
    reason: 'defectueux',
    dea:    openDea?._id || '',
    // Un DEA se désigne par son numéro de série, que le parc connaît déjà.
    number: presetKind === 'dae' ? (openDea?.serialNumber || '') : '',
    // Série ou lot : le champ dépend de la pièce réellement montée, pas du type.
    numberField: '',
    productName: '',
    replacementSerial: '',
    replacementExpiry: '',
    notes: '',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  /* Pièce du parc désignée comme défaillante — '' tant qu'on n'a rien choisi,
     'autre' pour une pièce que le parc ne connaît pas. */
  const [piece, setPiece] = useState('')

  const cfg       = replacementKind(form.kind)
  const isLot     = cfg.field === 'lotNumber'
  const alreadyDone = form.status === 'remplace'
  const selectedDea = deas.find(d => String(d._id) === String(form.dea))

  /* Un appareil porte souvent plusieurs pièces du même type : demander « le
     numéro de lot » sans dire laquelle revenait à le faire recopier depuis un
     autre écran, au risque de désigner la mauvaise. */
  const parcPieces = form.kind === 'dae' ? [] : (
    form.kind === 'electrodes' ? selectedDea?.electrodes : selectedDea?.batteries
  ) || []
  const pieceLabel = it => [
    it.productName || (form.kind === 'electrodes' ? 'Électrodes' : 'Batterie'),
    it.serialNumber || it.lotNumber,
    it.expiryDate ? `exp. ${new Date(it.expiryDate).toLocaleDateString('fr-FR')}` : '',
  ].filter(Boolean).join(' · ')

  /* Désigner la pièce remplit ce qui l'identifie : numéro, champ porteur et
     modèle. Le technicien n'a plus qu'à dire pourquoi. */
  function pickPiece(key) {
    setPiece(key)
    if (key === '' || key === 'autre') {
      setForm(f => ({ ...f, number: '', numberField: '', productName: key === 'autre' ? f.productName : '' }))
      return
    }
    const it = parcPieces[Number(key)]
    if (!it) return
    setForm(f => ({
      ...f,
      number:      it.serialNumber || it.lotNumber || '',
      numberField: it.serialNumber ? 'serialNumber' : 'lotNumber',
      productName: it.productName || f.productName,
    }))
  }

  /* La pièce posée se choisit dans le stock : c'est ce choix qui la sort de
     l'entrepôt. La saisie libre reste possible pour du matériel non suivi. */
  const { products, stock } = useCatalogStock(KIND_CATEGORY[form.kind] || 'batteries')
  const [pickedItem, setPickedItem] = useState(null)

  /* Modèle de l'appareil posé. Remplacer un DEA, c'est en poser un autre — le
     plus souvent le même modèle, qu'on propose d'emblée : le technicien ne
     confirme que le numéro de série.
     La proposition ne vaut qu'une fois par appareil : sans ce garde-fou, vider
     le champ le remplissait à nouveau dans la foulée, et le modèle devenait
     impossible à changer. */
  const [posedProduct, setPosedProduct] = useState(null)
  const suggestedFor = useRef(null)
  useEffect(() => {
    if (form.kind !== 'dae' || products.length === 0) return
    const key = `${form.kind}|${form.dea}`
    if (suggestedFor.current === key) return
    suggestedFor.current = key
    const current = selectedDea?.product?._id
    setPosedProduct(products.find(p => String(p._id) === String(current)) || null)
  }, [form.kind, form.dea, products, selectedDea])

  /* Série ou lot : c'est la catégorie du catalogue qui tranche, pas le type de
     pièce. Les batteries de ce parc se suivent par lot — chercher un n° de série
     ne ramènerait rien. */
  const [tracksSerial, setTracksSerial] = useState(null)
  useEffect(() => {
    let alive = true
    getProductCategories()
      .then(res => {
        const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : [])
        const cat  = list.find(c => c.slug === (KIND_CATEGORY[form.kind] || 'batteries'))
        if (alive && cat) setTracksSerial(Boolean(cat.tracksSerial))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [form.kind])

  /* Le numéro de série de l'appareil déposé vient du parc : le laisser
     modifiable inviterait à désigner un DEA qui n'est pas là. Il reste saisissable
     tant que le parc l'ignore — un appareil repris sans numéro doit pouvoir se
     signaler quand même. */
  const serialFromParc = form.kind === 'dae' && Boolean(selectedDea?.serialNumber)

  const stockField  = tracksSerial === null ? cfg.field : (tracksSerial ? 'serialNumber' : 'lotNumber')
  const stockIsLot  = stockField === 'lotNumber'
  const stockOptions = stockOptionsFor(stock, {
    field: stockField,
    // Un modèle retenu réduit la liste à ce qui se pose réellement ici.
    product: form.kind === 'dae' ? posedProduct : null,
    client,
  })

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  /* Changer de type change ce qu'on identifie : le numéro saisi ne vaut plus. */
  function setKind(kind) {
    setPiece('')
    setPosedProduct(null)
    suggestedFor.current = null
    setForm(f => ({
      ...f,
      numberField: '',
      kind,
      // Un DEA défectueux se désigne par le numéro de l'appareil du parc.
      number: kind === 'dae' ? (selectedDea?.serialNumber || '') : '',
    }))
  }

  function pickDea(id) {
    const d = deas.find(x => String(x._id) === String(id))
    setPiece('')
    setForm(f => ({
      ...f,
      numberField: '',
      dea: id,
      number: f.kind === 'dae' ? (d?.serialNumber || '') : f.number,
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!form.number.trim()) {
      setError(parcPieces.length > 0 && piece !== 'autre'
        ? 'Désignez la pièce concernée sur cet appareil.'
        : isLot
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
        [form.numberField || cfg.field]: form.number.trim(),
        product:     posedProduct?._id || undefined,
        productName: posedProduct?.name || form.productName.trim(),
        replacementSerial: alreadyDone ? form.replacementSerial.trim() : undefined,
        replacementExpiry: alreadyDone && form.replacementExpiry ? form.replacementExpiry : undefined,
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

          {/* Ce que le parc dit être monté sur cet appareil : on désigne la
              pièce plutôt que d'en recopier le numéro. */}
          {parcPieces.length > 0 && (
            <div className="form-group">
              <label className="form-label">Pièce concernée *</label>
              <select className="form-input form-input--plain" value={piece}
                onChange={e => pickPiece(e.target.value)}>
                <option value="">— Choisir la pièce montée —</option>
                {parcPieces.map((it, i) => (
                  <option key={it._id || i} value={String(i)}>{pieceLabel(it)}</option>
                ))}
                <option value="autre">Autre — non enregistrée sur cet appareil</option>
              </select>
            </div>
          )}

          <div className="form-row">
            {/* Le numéro se saisit à la main quand le parc ne connaît pas la
                pièce ; sinon il vient de la pièce désignée. */}
            {(parcPieces.length === 0 || piece === 'autre') && (
            <div className="form-group">
              <label className="form-label">
                {isLot ? 'N° de lot' : 'N° de série'} *
              </label>
              <input
                className={`form-input form-input--plain${serialFromParc ? ' form-input--ro' : ''}`}
                value={form.number}
                readOnly={serialFromParc}
                onChange={e => !serialFromParc && set('number', e.target.value)}
                placeholder={isLot ? 'Ex : L-2024-08' : 'Ex : B-88213'} />
              {serialFromParc && (
                <p className="form-hint">Numéro de l'appareil en place, repris de la fiche client.</p>
              )}
            </div>
            )}
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
                {form.kind === 'dae' ? 'Appareil posé' : 'Pièce posée'}
                <span className="form-label-opt"> (choisi dans le stock)</span> *
              </label>
              {form.kind === 'dae' && (
                <div style={{ marginBottom: 8 }}>
                  <label className="form-label">Modèle</label>
                  <ProductPicker
                    products={products}
                    stock={stockOptionsFor(stock, { field: stockField, client })}
                    value={posedProduct}
                    onChange={p => { setPosedProduct(p); setPickedItem(null); set('replacementSerial', '') }}
                    onClear={() => setPosedProduct(null)}
                    noun="modèle de défibrillateur"
                  />
                </div>
              )}

              <label className="form-label">
                {stockIsLot ? 'N° de lot' : 'N° de série'}
              </label>
              <StockPicker
                items={stockOptions}
                value={pickedItem}
                field={stockField}
                onChange={it => {
                  setPickedItem(it)
                  set('replacementSerial', it?.[stockField] || it?.serialNumber || it?.lotNumber || '')
                  // La péremption de l'article choisi épargne une saisie ; elle
                  // reste corrigeable, l'étiquette fait foi.
                  if (it?.expirationDate) set('replacementExpiry', toDateInput(it.expirationDate))
                }}
                onClear={() => { setPickedItem(null); set('replacementSerial', '') }}
                placeholder={`Rechercher un ${stockIsLot ? 'n° de lot' : 'n° de série'} en stock…`}
              />
              {/* La saisie libre ne sert qu'à ce que le stock ignore : une fois
                  l'article choisi, répéter son numéro juste en dessous n'apprend
                  rien et laisse croire à deux champs à remplir. */}
              {!pickedItem && (
                <input className="form-input form-input--plain" style={{ marginTop: 6 }}
                  value={form.replacementSerial}
                  onChange={e => set('replacementSerial', e.target.value)}
                  placeholder={stockIsLot
                    ? 'ou saisir un n° de lot absent du stock'
                    : 'ou saisir un n° de série absent du stock'} />
              )}

              {/* La péremption de la pièce posée part sur la fiche du DAE : sans
                  elle, le parc garderait celle de la pièce qu'on vient de retirer.
                  Un défibrillateur, lui, n'en a pas. */}
              {form.kind !== 'dae' && (
                <div style={{ marginTop: 8 }}>
                  <label className="form-label">Péremption de la pièce posée</label>
                  <input type="date" className="form-input form-input--plain"
                    value={form.replacementExpiry}
                    onChange={e => set('replacementExpiry', e.target.value)} />
                </div>
              )}
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
