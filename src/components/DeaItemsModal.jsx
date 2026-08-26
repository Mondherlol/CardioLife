import { useState, useEffect } from 'react'
import { X, AlertTriangle, Plus, Trash2, Zap, BatteryMedium } from 'lucide-react'
import { toast } from 'react-toastify'
import { updateDea } from '../api/sites'
import { getProductCategories } from '../api/productCategories'
import { expiryHint } from './siteHelpers'
import {
  useCatalogStock, stockOptionsFor, ProductPicker, StockPicker, ConfirmUnknown,
  formatApiError,
} from './stockPickers'

function toDateInput(value) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

const EMPTY_ELECTRODE = { productName: '', kind: '', lotNumber: '', expiryDate: '', notes: '' }
/* Une batterie qu'on vient de monter est pleine : le technicien corrige à la
   marge plutôt que de saisir « 100 » à chaque pose. */
const EMPTY_BATTERY   = { productName: '', serialNumber: '', activationDate: '', expiryDate: '', level: 100, notes: '' }

/** Le délai que représente une date de péremption, sous le champ qui la porte. */
function ExpiryHint({ value }) {
  const hint = expiryHint(value)
  if (!hint) return null
  return <p className={`expiry-hint expiry-hint--${hint.level}`}>{hint.text}</p>
}

const ELECTRODE_KINDS = [
  { value: 'adulte', label: 'Adulte' },
  { value: 'enfant', label: 'Enfant' },
  { value: '',       label: 'Non précisé' },
]

const CONFIG = {
  electrodes: {
    title:      'Électrodes',
    icon:       Zap,
    empty:      EMPTY_ELECTRODE,
    category:   'electrodes',
    // Suivi par défaut, le temps que la catégorie du catalogue réponde.
    field:      'lotNumber',
    addLabel:   'Ajouter une paire',
    emptyHint:  'Aucune électrode enregistrée sur ce DEA.',
    noun:       'modèle d\'électrodes',
    rowLabel:   'Jeu',
  },
  batteries: {
    title:      'Batteries',
    icon:       BatteryMedium,
    empty:      EMPTY_BATTERY,
    category:   'batteries',
    field:      'serialNumber',
    addLabel:   'Ajouter une batterie',
    emptyHint:  'Aucune batterie enregistrée sur ce DEA.',
    noun:       'modèle de batterie',
    rowLabel:   'Batterie',
  },
}

/**
 * Gestion des électrodes ou des batteries d'un DEA.
 *
 * Même règle que la pose d'un DEA : le modèle vient du catalogue et l'article
 * du stock. Une valeur inconnue n'est pas refusée — elle propose de créer le
 * modèle, ou d'entrer l'article en stock avant de le monter sur l'appareil.
 *
 * Props :
 *  site    - site propriétaire
 *  dea     - DEA concerné
 *  kind    - 'electrodes' | 'batteries'
 *  onClose - () => void
 *  onSaved - (résultat de `save`) => void
 *  save    - (items) => Promise, optionnel. La fiche d'intervention passe le
 *            sien : le technicien identifie la pièce sans avoir le droit de
 *            gestion des clients que demande la route des sites.
 */
export default function DeaItemsModal({ site, dea, kind, onClose, onSaved, save }) {
  const cfg   = CONFIG[kind]
  const Icon  = cfg.icon

  const { products, stock, addProduct, addStockItem } = useCatalogStock(cfg.category)

  /* Série ou lot : c'est la catégorie du catalogue qui tranche, pas le type de
     pièce. Les batteries de ce parc se suivent par lot ; leur demander un n° de
     série revenait à chercher dans un stock qui n'en porte aucun. */
  const [tracksSerial, setTracksSerial] = useState(null)
  useEffect(() => {
    let alive = true
    getProductCategories()
      .then(res => {
        const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : [])
        const cat  = list.find(c => c.slug === cfg.category)
        if (alive && cat) setTracksSerial(Boolean(cat.tracksSerial))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [cfg.category])

  // Tant que la catégorie n'a pas répondu, on garde l'usage historique du type.
  const field = tracksSerial === null
    ? cfg.field
    : (tracksSerial ? 'serialNumber' : 'lotNumber')
  const numberLabel = field === 'serialNumber' ? 'N° de série' : 'N° de lot'

  /* Une ligne porte les champs saisis, plus le modèle et l'article retenus.
     Les lignes déjà enregistrées n'ont que des libellés : on les présente comme
     « déjà en place » le temps de les rattacher au référentiel. */
  const newRow = () => ({ ...cfg.empty, product: null, stockItem: null, query: '' })

  /* Ouvrir sur une liste vide obligerait à cliquer « Ajouter » avant de
     pouvoir saisir quoi que ce soit : on ouvre la ligne pour lui. */
  const [items, setItems] = useState(() =>
    ((dea[kind] || []).length ? dea[kind] : [null]).map(it => (it === null ? newRow() : {
      ...cfg.empty,
      ...it,
      expiryDate:     toDateInput(it.expiryDate),
      activationDate: toDateInput(it.activationDate),
      level:          it.level ?? '',
      // L'id enregistré est mis de côté : `product` porte désormais la fiche
      // catalogue complète, résolue une fois le catalogue chargé.
      savedProductId: it.product ? String(it.product._id || it.product) : null,
      product: null,
      /* Série ou lot : la ligne déjà enregistrée porte l'un ou l'autre, et la
         catégorie peut ne pas avoir encore répondu. On garde les deux. */
      stockItem: (it.serialNumber || it.lotNumber)
        ? { _id: null, serialNumber: it.serialNumber, lotNumber: it.lotNumber, existing: true }
        : null,
      query: '',
    }))
  )

  // Confirmation en cours : { row, mode: 'product' | 'stock', label }
  const [confirm,     setConfirm]     = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmErr,  setConfirmErr]  = useState('')

  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  // Lignes dont les champs secondaires sont dépliés : { [index]: true }.
  const [details, setDetails] = useState({})

  /* Rattache les lignes existantes à leur fiche catalogue dès son chargement. */
  useEffect(() => {
    if (products.length === 0) return
    setItems(list => list.map(it => {
      if (it.product) return it
      const found = it.savedProductId
        ? products.find(p => p._id === it.savedProductId)
        : products.find(p => p.name.toLowerCase() === String(it.productName || '').trim().toLowerCase())
      return found ? { ...it, product: found } : it
    }))
  }, [products])

  function patch(idx, changes) {
    setItems(list => list.map((it, i) => (i === idx ? { ...it, ...changes } : it)))
  }
  function setItem(idx, key, value) { patch(idx, { [key]: value }) }
  function addItem()       { setItems(list => [...list, newRow()]) }
  function removeItem(idx) { setItems(list => list.filter((_, i) => i !== idx)) }

  /* Prendre un article au stock renseigne aussi le modèle et la péremption :
     ces informations appartiennent à l'article, les ressaisir inviterait à
     l'erreur. */
  function pickStock(idx, it) {
    const p = products.find(pr => pr._id === String(it.product?._id || it.product))
    patch(idx, {
      stockItem: it,
      [field]:   it[field] || '',
      query:     '',
      ...(p ? { product: p, productName: p.name } : {}),
      ...(it.expirationDate ? { expiryDate: toDateInput(it.expirationDate) } : {}),
    })
  }

  function pickProduct(idx, p) {
    const row = items[idx]
    patch(idx, {
      product: p, productName: p.name,
      // L'article retenu appartenait à l'ancien modèle : il ne vaut plus.
      ...(row.stockItem && !row.stockItem.existing ? { stockItem: null, [field]: '' } : {}),
    })
  }

  function clearProduct(idx) {
    const row = items[idx]
    patch(idx, {
      product: null, productName: '',
      ...(row.stockItem && !row.stockItem.existing ? { stockItem: null, [field]: '' } : {}),
    })
  }

  /* ── Confirmations ── */

  function ask(row, mode, label) {
    const clean = String(label || '').trim()
    if (!clean) return
    setConfirmErr('')
    setConfirm({ row, mode, label: clean })
  }

  async function runConfirm() {
    const { row, mode, label } = confirm
    setConfirmBusy(true)
    setConfirmErr('')
    try {
      if (mode === 'product') {
        const p = await addProduct(label, cfg.category)
        patch(row, { product: p, productName: p.name })
        toast.success(`Modèle « ${p.name} » créé.`)
      } else {
        const created = await addStockItem(items[row].product, {
          [field]: label,
          expirationDate: items[row].expiryDate || undefined,
        })
        patch(row, { stockItem: created, [field]: label, query: '' })
        toast.success(`${label} entré en stock.`)
      }
      setConfirm(null)
    } catch (err) {
      setConfirmErr(formatApiError(err))
    } finally {
      setConfirmBusy(false)
    }
  }

  /* ── Enregistrement ── */

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    // Une ligne sans modèle ne dit pas ce qui est monté sur l'appareil.
    const orphan = items.findIndex(it => !it.product)
    if (orphan !== -1) {
      setError(`Ligne #${orphan + 1} : choisissez un modèle au catalogue.`)
      return
    }
    // Une saisie laissée en plan serait perdue en silence.
    const pending = items.findIndex(it => !it.stockItem && it.query?.trim())
    if (pending !== -1) {
      ask(pending, 'stock', items[pending].query)
      return
    }

    setLoading(true)
    try {
      const payload = items.map(it => {
        const base = {
          product:     it.product._id,
          productName: it.product.name,
          expiryDate:  it.expiryDate || null,
          notes:       it.notes,
        }
        // L'identifiant retenu va dans le champ que suit la catégorie : ranger
        // un n° de lot dans `serialNumber` rendrait le parc illisible.
        const number = { serialNumber: '', lotNumber: '', [field]: it.stockItem?.[field] || '' }

        return kind === 'batteries'
          ? { ...base, ...number,
              activationDate: it.activationDate || null,
              level:          it.level === '' ? null : Number(it.level) }
          : { ...base, ...number, kind: it.kind }
      })

      const updated = save
        ? await save(payload)
        : await updateDea(site._id, dea._id, { [kind]: payload })
      toast.success(`${cfg.title} mises à jour.`)
      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--lg">
        <div className="modal-header">
          <h2 className="modal-title"><Icon size={16} /> {cfg.title}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <p className="dea-modal-site">
            <span>{site.name}</span>
            <span className="dea-modal-sep">·</span>
            <strong>{dea.deviceType || 'DEA'}</strong>
            {dea.serialNumber && <span className="inst-sn-chip">{dea.serialNumber}</span>}
          </p>

          {items.length === 0 && <p className="cd-empty-hint">{cfg.emptyHint}</p>}

          {items.map((it, i) => (
            <div key={i} className="dea-item-card">
              <div className="dea-item-head">
                <span className="dea-item-index">
                  {it.product?.name || it.productName || `${cfg.rowLabel} ${i + 1}`}
                </span>
                {/* Retirer la dernière ligne reste possible : une pièce déposée
                    et non remplacée doit pouvoir se déclarer. */}
                <button type="button" className="remove-field-btn" title="Retirer"
                  onClick={() => removeItem(i)}>
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="dea-item-grid">
                <div className="form-group dea-item-grid-wide">
                  <label className="form-label">Modèle *</label>
                  <ProductPicker
                    products={products}
                    value={it.product}
                    onChange={p => pickProduct(i, p)}
                    onClear={() => clearProduct(i)}
                    onUnknown={label => ask(i, 'product', label)}
                    noun={cfg.noun}
                  />
                </div>
                <div className="form-group dea-item-grid-wide">
                  <label className="form-label">{numberLabel}</label>
                  <StockPicker
                    items={stockOptionsFor(stock, { product: it.product, field })}
                    value={it.stockItem}
                    onChange={picked => pickStock(i, picked)}
                    onClear={() => patch(i, { stockItem: null, [field]: '' })}
                    onUnknown={label => ask(i, 'stock', label)}
                    onQueryChange={q => patch(i, { query: q })}
                    field={field}
                    product={it.product}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Péremption</label>
                  <input type="date" className="form-input form-input--plain" value={it.expiryDate}
                    onChange={e => setItem(i, 'expiryDate', e.target.value)} />
                  <ExpiryHint value={it.expiryDate} />
                </div>

                {kind === 'electrodes' ? (
                  <div className="form-group">
                    <label className="form-label">Catégorie</label>
                    {/* Trois choix qu'on touche du doigt : sur tablette, dérouler
                        une liste pour deux options coûte plus qu'elle ne rapporte. */}
                    <div className="dea-chips">
                      {ELECTRODE_KINDS.map(k => (
                        <button key={k.value} type="button"
                          className={`dea-chip${it.kind === k.value ? ' dea-chip--on' : ''}`}
                          onClick={() => setItem(i, 'kind', k.value)}>
                          {k.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Niveau de charge</label>
                    <div className="dea-pct">
                      <input type="number" min="0" max="100" className="form-input form-input--plain"
                        value={it.level} onChange={e => setItem(i, 'level', e.target.value)} />
                      <span>%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Date d'activation et note ne servent qu'à la marge : elles ne
                  méritent pas de tenir la moitié de l'écran à chaque saisie. */}
              {details[i] ? (
                <div className="dea-item-grid dea-item-more">
                  {kind === 'batteries' && (
                    <div className="form-group">
                      <label className="form-label">Date d'activation</label>
                      <input type="date" className="form-input form-input--plain" value={it.activationDate}
                        onChange={e => setItem(i, 'activationDate', e.target.value)} />
                    </div>
                  )}
                  <div className="form-group dea-item-grid-wide">
                    <label className="form-label">Note</label>
                    <input className="form-input form-input--plain" value={it.notes}
                      onChange={e => setItem(i, 'notes', e.target.value)} placeholder="Remarque…" />
                  </div>
                </div>
              ) : (
                <button type="button" className="add-field-btn dea-item-more-btn"
                  onClick={() => setDetails(d => ({ ...d, [i]: true }))}>
                  <Plus size={12} /> {kind === 'batteries' ? 'Activation, note' : 'Note'}
                </button>
              )}
            </div>
          ))}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer dea-item-footer">
            <button type="button" className="add-field-btn" onClick={addItem}>
              <Plus size={12} /> {cfg.addLabel}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>

      {confirm && (
        <ConfirmUnknown
          mode={confirm.mode}
          label={confirm.label}
          product={items[confirm.row]?.product}
          field={field}
          categoryLabel={cfg.noun}
          busy={confirmBusy}
          error={confirmErr}
          onConfirm={runConfirm}
          onCancel={() => { setConfirm(null); setConfirmErr('') }}
        />
      )}
    </div>
  )
}
