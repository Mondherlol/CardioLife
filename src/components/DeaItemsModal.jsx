import { useState, useEffect } from 'react'
import { X, AlertTriangle, Plus, Trash2, Zap, BatteryMedium } from 'lucide-react'
import { toast } from 'react-toastify'
import { updateDea } from '../api/sites'
import {
  useCatalogStock, stockOptionsFor, ProductPicker, StockPicker, ConfirmUnknown,
  formatApiError,
} from './stockPickers'

function toDateInput(value) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

const EMPTY_ELECTRODE = { productName: '', kind: '', lotNumber: '', expiryDate: '', notes: '' }
const EMPTY_BATTERY   = { productName: '', serialNumber: '', activationDate: '', expiryDate: '', level: '', notes: '' }

const CONFIG = {
  electrodes: {
    title:      'Électrodes',
    icon:       Zap,
    empty:      EMPTY_ELECTRODE,
    category:   'electrodes',
    // Les électrodes se suivent par lot, les batteries à l'exemplaire.
    field:      'lotNumber',
    addLabel:   'Ajouter une paire',
    emptyHint:  'Aucune électrode enregistrée sur ce DEA.',
    noun:       'modèle d\'électrodes',
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
 *  onSaved - (site) => void
 */
export default function DeaItemsModal({ site, dea, kind, onClose, onSaved }) {
  const cfg   = CONFIG[kind]
  const Icon  = cfg.icon
  const field = cfg.field

  const { products, stock, addProduct, addStockItem } = useCatalogStock(cfg.category)

  /* Une ligne porte les champs saisis, plus le modèle et l'article retenus.
     Les lignes déjà enregistrées n'ont que des libellés : on les présente comme
     « déjà en place » le temps de les rattacher au référentiel. */
  const [items, setItems] = useState(() =>
    (dea[kind] || []).map(it => ({
      ...cfg.empty,
      ...it,
      expiryDate:     toDateInput(it.expiryDate),
      activationDate: toDateInput(it.activationDate),
      level:          it.level ?? '',
      // L'id enregistré est mis de côté : `product` porte désormais la fiche
      // catalogue complète, résolue une fois le catalogue chargé.
      savedProductId: it.product ? String(it.product._id || it.product) : null,
      product: null,
      stockItem: it[field]
        ? { _id: null, [field]: it[field], existing: true }
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
  function addItem()       { setItems(list => [...list, { ...cfg.empty, product: null, stockItem: null, query: '' }]) }
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
        return kind === 'batteries'
          ? { ...base,
              serialNumber:   it.stockItem?.serialNumber || '',
              activationDate: it.activationDate || null,
              level:          it.level === '' ? null : Number(it.level) }
          : { ...base, kind: it.kind, lotNumber: it.stockItem?.lotNumber || '' }
      })

      const updated = await updateDea(site._id, dea._id, { [kind]: payload })
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
            {site.name} · <strong>{dea.deviceType || 'DEA'}</strong>
            {dea.serialNumber && <span className="inst-sn-chip" style={{ marginLeft: 8 }}>{dea.serialNumber}</span>}
          </p>

          <div className="form-label-row">
            <div className="form-section-title" style={{ margin: 0 }}>{cfg.title} ({items.length})</div>
            <button type="button" className="add-field-btn" onClick={addItem}>
              <Plus size={12} /> {cfg.addLabel}
            </button>
          </div>

          {items.length === 0 && <p className="cd-empty-hint">{cfg.emptyHint}</p>}

          {items.map((it, i) => (
            <div key={i} className="dea-item-card">
              <div className="dea-item-head">
                <span className="dea-item-index">#{i + 1}</span>
                <button type="button" className="remove-field-btn" title="Retirer"
                  onClick={() => removeItem(i)}>
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="form-row">
                <div className="form-group">
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
                <div className="form-group">
                  <label className="form-label">
                    {field === 'serialNumber' ? 'N° de série' : 'N° de lot'}
                    <span className="form-label-opt"> (depuis le stock)</span>
                  </label>
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
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Date de péremption</label>
                  <input type="date" className="form-input form-input--plain" value={it.expiryDate}
                    onChange={e => setItem(i, 'expiryDate', e.target.value)} />
                </div>
                {kind === 'electrodes' ? (
                  <div className="form-group">
                    <label className="form-label">Catégorie</label>
                    <select className="form-input form-input--plain" value={it.kind}
                      onChange={e => setItem(i, 'kind', e.target.value)}>
                      <option value="">Non précisé</option>
                      <option value="adulte">Adulte</option>
                      <option value="enfant">Enfant</option>
                    </select>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Date d'activation</label>
                    <input type="date" className="form-input form-input--plain" value={it.activationDate}
                      onChange={e => setItem(i, 'activationDate', e.target.value)} />
                  </div>
                )}
              </div>

              {kind === 'batteries' && (
                <div className="form-group" style={{ maxWidth: '50%' }}>
                  <label className="form-label">Niveau de charge (%)</label>
                  <input type="number" min="0" max="100" className="form-input form-input--plain"
                    value={it.level} onChange={e => setItem(i, 'level', e.target.value)} placeholder="0 – 100" />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="form-input form-input--plain" value={it.notes}
                  onChange={e => setItem(i, 'notes', e.target.value)} placeholder="Remarque…" />
              </div>
            </div>
          ))}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
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
