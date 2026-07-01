import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Pencil, SlidersHorizontal, X, AlertTriangle, Package,
  TrendingUp, TrendingDown, Clock, CheckCircle2, History,
  Users, ShoppingCart, Info, User, ImagePlus, Trash2,
  ChevronLeft, ChevronRight, Hash, Layers, FileText, Search,
  Globe, Plus, Save,
} from 'lucide-react'
import {
  getProduct, getMovements, adjustStock,
  uploadProductImage, deleteProductImage, productImageUrl,
  updateProduct, patchProduct,
} from '../api/products'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ProductModal from '../components/ProductModal'

/* ─── Constants ─── */
const CATEGORIES = [
  { value: 'defibrillateur',    label: 'Défibrillateur',    color: 'cat--orange' },
  { value: 'batterie',          label: 'Batterie',          color: 'cat--amber'  },
  { value: 'electrodes_adulte', label: 'Électrodes adulte', color: 'cat--blue'   },
  { value: 'electrodes_enfant', label: 'Électrodes enfant', color: 'cat--purple' },
  { value: 'boitier',           label: 'Boîtier mural',     color: 'cat--teal'   },
  { value: 'signaletique',      label: 'Signalétique',      color: 'cat--green'  },
  { value: 'accessoire',        label: 'Accessoire',        color: 'cat--gray'   },
  { value: 'kit_secours',       label: 'Kit de secours',    color: 'cat--red'    },
  { value: 'autre',             label: 'Autre',             color: 'cat--gray'   },
]
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]))

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

function getStockStatus(stock, threshold) {
  if (stock === 0)        return 'out'
  if (stock <= threshold) return 'low'
  return 'ok'
}

function getExpirationStatus(dateStr) {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const now  = new Date()
  const days = Math.ceil((date - now) / (1000 * 60 * 60 * 24))
  if (days < 0)   return { level: 'expired', days }
  if (days <= 30) return { level: 'urgent',  days }
  if (days <= 90) return { level: 'soon',    days }
  return { level: 'ok', days }
}

function formatDate(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatPrice(val) {
  if (val == null || val === '') return '—'
  return `${Number(val).toLocaleString('fr-FR')} DT`
}

function RichText({ html }) {
  if (!html) return null
  return <div className="pd-richtext" dangerouslySetInnerHTML={{ __html: html }} />
}

/* ─── Shared UI components ─── */
function CategoryBadge({ category }) {
  const cat = CAT_MAP[category]
  if (!cat) return <span className="type-badge">{category}</span>
  return <span className={`cat-badge ${cat.color}`}>{cat.label}</span>
}

function StockIndicator({ stock, threshold }) {
  const status = getStockStatus(stock, threshold)
  const pct    = threshold > 0 ? Math.min((stock / (threshold * 2)) * 100, 100) : (stock > 0 ? 100 : 0)
  return (
    <div className="stock-cell">
      <div className="stock-cell-top">
        <span className={`stock-qty-label stock-qty-label--${status}`}>{stock}</span>
        <span className="stock-threshold-label">/ min {threshold}</span>
      </div>
      <div className="stock-mini-bar">
        <div className={`stock-mini-fill stock-mini-fill--${status}`} style={{ width: `${pct}%` }} />
      </div>
      {status === 'out' && <span className="stock-status-chip stock-status-chip--out">Épuisé</span>}
      {status === 'low' && <span className="stock-status-chip stock-status-chip--low">Stock faible</span>}
    </div>
  )
}

function ExpirationBadge({ date }) {
  const exp = getExpirationStatus(date)
  if (!exp) return <span className="cell-muted">—</span>
  return (
    <div className="exp-cell">
      <span className="exp-date">{formatDate(date)}</span>
      <span className={`exp-badge exp-badge--${exp.level}`}>
        {exp.level === 'expired' && <AlertTriangle size={10} />}
        {(exp.level === 'urgent' || exp.level === 'soon') && <Clock size={10} />}
        {exp.level === 'ok' && <CheckCircle2 size={10} />}
        {exp.level === 'expired' ? 'Expiré' : exp.level === 'ok' ? 'OK' : `${exp.days}j`}
      </span>
    </div>
  )
}

/* ─── Movement row ─── */
function MovementRow({ mv, onClick }) {
  const isEntree  = mv.type === 'entree'
  const isSortie  = mv.type === 'sortie'
  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : SlidersHorizontal
  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : 'Correction'
  const sign      = isEntree ? '+' : isSortie ? '-' : '→'
  const hasTrace  = (mv.serialNumbers?.length ?? 0) > 0 || !!mv.lotNumber

  return (
    <div className={`mv-row${onClick ? ' mv-row--clickable' : ''}`} onClick={onClick}>
      <div className={`mv-badge mv-badge--${cls}`}>
        <TypeIcon size={12} />
        {sign}{mv.quantity}
      </div>
      <div className="mv-info">
        <div className="mv-type-line">
          <span className="mv-type-label">{typeLabel}</span>
          {mv.reason && <span className="mv-reason">— {mv.reason}</span>}
          {hasTrace && <span className="mv-trace-hint">· traçabilité</span>}
        </div>
        <div className="mv-meta">
          {(mv.createdBy?.fullName || mv.createdBy?.username) && (
            <span><User size={10} /> {mv.createdBy.fullName || mv.createdBy.username}</span>
          )}
          <span>{formatDateTime(mv.createdAt)}</span>
          {mv.previousStock != null && mv.newStock != null && (
            <span className="mv-stocks">{mv.previousStock} → {mv.newStock}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Movement detail modal ─── */
function MovementDetailModal({ movement, onClose }) {
  const isEntree  = movement.type === 'entree'
  const isSortie  = movement.type === 'sortie'
  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : SlidersHorizontal
  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : 'Correction'
  const sign      = isEntree ? '+' : isSortie ? '-' : '→'
  const hasSerials = (movement.serialNumbers?.length ?? 0) > 0
  const hasLot     = !!movement.lotNumber

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Détail du mouvement</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="mv-detail-header">
            <div className={`mv-badge mv-badge--${cls}`}>
              <TypeIcon size={12} /> {sign}{movement.quantity}
            </div>
            <div className="mv-detail-meta">
              <span className="mv-type-label">{typeLabel}</span>
              {movement.reason && <div className="mv-reason" style={{ marginTop: 2 }}>{movement.reason}</div>}
              <div className="mv-meta" style={{ marginTop: 4 }}>
                {(movement.createdBy?.fullName || movement.createdBy?.username) && (
                  <span><User size={10} /> {movement.createdBy.fullName || movement.createdBy.username}</span>
                )}
                <span>{formatDateTime(movement.createdAt)}</span>
                {movement.previousStock != null && movement.newStock != null && (
                  <span className="mv-stocks">{movement.previousStock} → {movement.newStock}</span>
                )}
              </div>
            </div>
          </div>

          {hasSerials && (
            <div className="mv-detail-section">
              <div className="mv-detail-section-title">
                <Hash size={13} /> Numéros de série ({movement.serialNumbers.length})
              </div>
              <div className="mv-serials-list">
                {movement.serialNumbers.map((sn, i) => (
                  <span key={i} className="mv-serial-chip">{sn}</span>
                ))}
              </div>
            </div>
          )}

          {hasLot && (
            <div className="mv-detail-section">
              <div className="mv-detail-section-title">
                <Layers size={13} /> Numéro de lot
              </div>
              <div className="mv-lot-info">
                <span className="mv-lot-chip">{movement.lotNumber}</span>
                {movement.expirationDate && (
                  <span className="mv-lot-expiry">
                    Péremption : {formatDate(movement.expirationDate)}
                  </span>
                )}
              </div>
            </div>
          )}

          {!hasSerials && !hasLot && (
            <div className="pd-empty" style={{ padding: '20px 0' }}>
              <p>Aucune traçabilité enregistrée pour ce mouvement.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Stock adjust modal ─── */
function StockAdjustModal({ product, onClose, onDone }) {
  const [type,            setType]            = useState('entree')
  const [quantity,        setQuantity]        = useState('')
  const [reason,          setReason]          = useState('')
  // Entrée — serial textarea
  const [serialsText,     setSerialsText]     = useState('')
  const [lotNumber,       setLotNumber]       = useState('')
  const [expirationDate,  setExpirationDate]  = useState('')
  // Sortie — serial picker
  const [selectedSerials, setSelectedSerials] = useState([])
  const [serialSearch,    setSerialSearch]    = useState('')
  // Sortie — lot picker
  const [selectedLot,     setSelectedLot]     = useState('')

  const [error,           setError]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [inStockSerials,  setInStockSerials]  = useState([])
  const [inStockLots,     setInStockLots]     = useState([])

  useEffect(() => {
    if (!product.requiresSerialNumber && !product.requiresLotNumber) return
    getMovements(product._id)
      .then(raw => {
        const mvs = Array.isArray(raw) ? raw : (raw.data || [])
        if (product.requiresSerialNumber) {
          const entered = new Set()
          const exited  = new Set()
          mvs.forEach(mv => {
            if (mv.type === 'entree') mv.serialNumbers?.forEach(sn => entered.add(sn))
            if (mv.type === 'sortie') mv.serialNumbers?.forEach(sn => exited.add(sn))
          })
          setInStockSerials([...entered].filter(sn => !exited.has(sn)))
        }
        if (product.requiresLotNumber) {
          const lotMap = {}
          mvs.forEach(mv => {
            if (mv.type === 'entree' && mv.lotNumber)
              lotMap[mv.lotNumber] = (lotMap[mv.lotNumber] || 0) + (mv.quantity || 0)
            if (mv.type === 'sortie' && mv.lotNumber)
              lotMap[mv.lotNumber] = (lotMap[mv.lotNumber] || 0) - (mv.quantity || 0)
          })
          setInStockLots(
            Object.entries(lotMap)
              .filter(([, q]) => q > 0)
              .map(([lot, q]) => ({ lot, qty: q }))
          )
        }
      })
      .catch(() => {})
  }, [product._id, product.requiresSerialNumber, product.requiresLotNumber])

  const isSortieSerial   = type === 'sortie' && product.requiresSerialNumber
  const needsSerialEntry = type === 'entree'  && product.requiresSerialNumber
  const needsLotEntry    = product.requiresLotNumber && type === 'entree'

  const qty      = isSortieSerial ? selectedSerials.length : Number(quantity) || 0
  const newStock = type === 'entree' ? product.stock + qty : product.stock - qty

  const serialLines = serialsText.split('\n').map(s => s.trim()).filter(Boolean)
  const serialsOk   = !needsSerialEntry || (qty > 0 && serialLines.length === qty)

  const duplicatesInInput = needsSerialEntry
    ? serialLines.filter((sn, i) => serialLines.indexOf(sn) !== i)
    : []
  const alreadyInStock = needsSerialEntry
    ? serialLines.filter(sn => inStockSerials.includes(sn))
    : []

  const filteredAvailableSerials = inStockSerials
    .filter(sn => !selectedSerials.includes(sn))
    .filter(sn => !serialSearch || sn.toLowerCase().includes(serialSearch.toLowerCase()))

  function addSerial(sn)    { setSelectedSerials(p => [...p, sn]) }
  function removeSerial(sn) { setSelectedSerials(p => p.filter(s => s !== sn)) }

  function switchType(t) {
    setType(t)
    setSelectedSerials([])
    setSerialsText('')
    setSerialSearch('')
    setSelectedLot('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (qty <= 0) { setError('La quantité doit être supérieure à 0.'); return }
    if (needsSerialEntry && serialLines.length !== qty) {
      setError(`Saisissez exactement ${qty} numéro${qty > 1 ? 's' : ''} de série.`); return
    }
    if (duplicatesInInput.length > 0) {
      setError(`En double : ${[...new Set(duplicatesInInput)].join(', ')}`); return
    }
    if (alreadyInStock.length > 0) {
      setError(`Déjà en stock : ${alreadyInStock.join(', ')}`); return
    }
    if (type === 'sortie' && product.requiresLotNumber && !selectedLot) {
      setError('Sélectionnez un lot.'); return
    }
    setError('')
    setLoading(true)
    try {
      const finalSerials = isSortieSerial ? selectedSerials : needsSerialEntry ? serialLines : []
      const finalLot = type === 'sortie' && product.requiresLotNumber
        ? selectedLot
        : needsLotEntry && lotNumber ? lotNumber : undefined

      await adjustStock(product._id, {
        type, quantity: qty, reason,
        serialNumbers:  finalSerials,
        lotNumber:      finalLot || undefined,
        expirationDate: needsLotEntry && expirationDate ? expirationDate : undefined,
      })
      toast.success('Stock mis à jour.')
      onDone()
    } catch (err) {
      setError(formatApiError(err))
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Ajuster le stock</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          {/* Produit */}
          <div className="adjust-product-card">
            <Package size={16} color="var(--orange-500)" />
            <div>
              <div className="adjust-product-name">{product.name}</div>
              {product.reference && <div className="adjust-product-ref">Réf. {product.reference}</div>}
            </div>
            <div className="adjust-current-stock">
              <span className="adjust-stock-num">{product.stock}</span>
              <span className="adjust-stock-label">en stock</span>
            </div>
          </div>

          {/* Type */}
          <div className="form-group">
            <label className="form-label">Type de mouvement</label>
            <div className="adjust-type-row">
              {[
                { value: 'entree', icon: TrendingUp,  label: 'Entrée', cls: 'entree' },
                { value: 'sortie', icon: TrendingDown, label: 'Sortie', cls: 'sortie' },
              ].map(({ value, icon: Icon, label, cls }) => (
                <button key={value} type="button"
                  onClick={() => switchType(value)}
                  className={`adjust-type-btn adjust-type-btn--${cls}${type === value ? ' adjust-type-btn--active' : ''}`}
                  style={{ flex: 1 }}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Quantité — masquée pour sortie+serial (auto-calculée) */}
          {!isSortieSerial && (
            <div className="form-group">
              <label className="form-label">Quantité</label>
              <input className="form-input form-input--plain" type="number" min="1"
                value={quantity} onChange={e => setQuantity(e.target.value)}
                placeholder="Quantité…" required autoFocus />
            </div>
          )}

          {/* SORTIE + SERIAL : sélection depuis le stock */}
          {isSortieSerial && (
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Numéros de série à retirer</span>
                <span className={`adj-serial-count${selectedSerials.length > 0 ? ' adj-serial-count--ok' : ''}`}>
                  {selectedSerials.length} sélectionné{selectedSerials.length !== 1 ? 's' : ''}
                </span>
              </label>

              {selectedSerials.length > 0 && (
                <div className="adj-selected-serials">
                  {selectedSerials.map(sn => (
                    <span key={sn} className="adj-selected-chip">
                      {sn}
                      <button type="button" className="adj-chip-remove" onClick={() => removeSerial(sn)}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {inStockSerials.length > 0 ? (
                <>
                  <div className="adj-serial-search-wrap">
                    <Search size={13} className="adj-serial-search-icon" />
                    <input
                      className="form-input form-input--plain"
                      style={{ paddingLeft: 30 }}
                      placeholder="Rechercher un numéro de série…"
                      value={serialSearch}
                      onChange={e => setSerialSearch(e.target.value)}
                    />
                  </div>
                  <div className="adj-serial-available">
                    {filteredAvailableSerials.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
                        {serialSearch ? 'Aucun résultat.' : 'Tous les numéros sont déjà sélectionnés.'}
                      </p>
                    ) : (
                      filteredAvailableSerials.slice(0, 60).map(sn => (
                        <button key={sn} type="button" className="adj-available-chip" onClick={() => addSerial(sn)}>
                          {sn}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--gray-50)', borderRadius: 8, border: '1px dashed var(--gray-200)' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                    Aucun numéro de série enregistré en stock pour ce produit.
                  </p>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ fontSize: 12, padding: '5px 12px', gap: 6 }}
                    onClick={() => switchType('entree')}
                  >
                    <TrendingUp size={12} /> Faire une entrée de stock
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ENTRÉE + SERIAL : saisie textarea */}
          {needsSerialEntry && (
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Numéros de série <span style={{ color: 'var(--red-500)' }}>*</span></span>
                <span className={`adj-serial-count${serialsOk ? ' adj-serial-count--ok' : qty > 0 ? ' adj-serial-count--err' : ''}`}>
                  {serialLines.length} / {qty || '?'}
                </span>
              </label>
              <textarea
                className="form-input form-input--plain form-textarea"
                rows={Math.max(3, Math.min(qty, 8))}
                value={serialsText}
                onChange={e => setSerialsText(e.target.value)}
                placeholder={"Un numéro de série par ligne\nex. SN-001\nSN-002"}
              />
              <p className="adj-serial-hint">Un numéro par ligne — vous pouvez coller depuis un scanner</p>
              {duplicatesInInput.length > 0 && (
                <div className="adj-serial-warn">
                  <AlertTriangle size={12} /> En double : {[...new Set(duplicatesInInput)].join(', ')}
                </div>
              )}
              {alreadyInStock.length > 0 && (
                <div className="adj-serial-warn">
                  <AlertTriangle size={12} /> Déjà en stock : {alreadyInStock.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* LOT ENTRÉE */}
          {needsLotEntry && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">N° de lot <span style={{ color: 'var(--red-500)' }}>*</span></label>
                <input className="form-input form-input--plain" value={lotNumber}
                  onChange={e => setLotNumber(e.target.value)}
                  placeholder="LOT-2025-001" required />
              </div>
              <div className="form-group">
                <label className="form-label">Date de péremption</label>
                <input className="form-input form-input--plain" type="date"
                  value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
              </div>
            </div>
          )}

          {/* LOT SORTIE */}
          {type === 'sortie' && product.requiresLotNumber && (
            <div className="form-group">
              <label className="form-label">Lot à sortir</label>
              {inStockLots.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aucun lot en stock.</p>
              ) : (
                <select
                  className="form-input form-input--plain"
                  value={selectedLot}
                  onChange={e => setSelectedLot(e.target.value)}
                >
                  <option value="">— Sélectionner un lot —</option>
                  {inStockLots.map(({ lot, qty: lq }) => (
                    <option key={lot} value={lot}>{lot} ({lq} en stock)</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Aperçu */}
          {qty > 0 && (
            <div className={`adjust-preview${newStock < 0 ? ' adjust-preview--danger' : ''}`}>
              <span>Stock après :</span>
              <strong style={{ color: newStock < 0 ? 'var(--red-600)' : 'var(--text-primary)' }}>
                {newStock < 0 ? 'Insuffisant !' : newStock}
              </strong>
            </div>
          )}

          {/* Motif */}
          <div className="form-group">
            <label className="form-label">Motif <span className="form-label-opt">(optionnel)</span></label>
            <input className="form-input form-input--plain" value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="ex. Livraison fournisseur, Installation client…" />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary"
              disabled={loading || qty <= 0 || newStock < 0}>
              {loading ? <span className="login-btn-spinner" /> : 'Valider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── WebCardTab ─── */
function WebCardTab({ product, onSaved }) {
  const wc = product.webCard || {}
  const [form, setForm] = useState({
    title:       wc.title       ?? product.name        ?? '',
    description: wc.description ?? product.description ?? '',
    features:    wc.features    ?? [],
  })
  const [saving, setSaving]             = useState(false)
  const [featureInput, setFeatureInput] = useState('')
  const [listed, setListed]             = useState(product.listedOnWebsite !== false)
  const [togglingListed, setTogglingListed] = useState(false)

  async function handleToggleListed() {
    const next = !listed
    setListed(next)
    setTogglingListed(true)
    try {
      const updated = await patchProduct(product._id, { listedOnWebsite: next })
      onSaved(updated)
      toast.success(next ? 'Produit visible sur le site web.' : 'Produit masqué du site web.')
    } catch (err) {
      setListed(!next)
      toast.error(formatApiError(err))
    } finally {
      setTogglingListed(false)
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addFeature = async () => {
    const val = featureInput.trim()
    if (!val) return
    const newFeatures = [...form.features, val]
    set('features', newFeatures)
    setFeatureInput('')
    try {
      const updated = await updateProduct(product._id, {
        name:     product.name,
        category: product.category,
        webCard:  { ...form, features: newFeatures },
      })
      onSaved(updated)
    } catch (err) {
      toast.error(formatApiError(err))
    }
  }
  const removeFeature = (i) => set('features', form.features.filter((_, idx) => idx !== i))
  const updateFeature = (i, v) => set('features', form.features.map((f, idx) => idx === i ? v : f))

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await updateProduct(product._id, {
        name:     product.name,
        category: product.category,
        webCard:  form,
      })
      onSaved(updated)
      toast.success('Fiche site web mise à jour.')
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const coverImage = product.images?.[0] ? productImageUrl(product.images[0]) : null

  return (
    <div className="wc-layout">
      {/* ── Aperçu ── */}
      <div className="wc-preview-col">
        <div className="wc-preview-label"><Globe size={13} /> Aperçu de la fiche</div>
        <div className="wc-card">
          {/* Image */}
          <div className="wc-card-img-wrap">
            {coverImage
              ? <img src={coverImage} alt={form.title} className="wc-card-img" />
              : <div className="wc-card-img-placeholder"><Package size={40} color="var(--gray-300)" /></div>
            }
          </div>

          {/* Contenu */}
          <div className="wc-card-body">
            <h2 className="wc-card-title">{form.title || <span className="wc-placeholder">Titre du produit</span>}</h2>
            {product.reference && (
              <div className="wc-card-slug">Réf. <code>{product.reference}</code></div>
            )}
            {form.description && (
              <div className="wc-card-desc" dangerouslySetInnerHTML={{ __html: form.description }} />
            )}
            {form.features.length > 0 && (
              <div className="wc-card-features">
                <div className="wc-features-label">CARACTÉRISTIQUES</div>
                {form.features.map((f, i) => (
                  <div key={i} className="wc-feature-row">
                    <CheckCircle2 size={14} color="#22c55e" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="wc-cta-btn">
              <ShoppingCart size={16} /> Demander un devis
            </button>
            <button className="wc-secondary-btn">Continuer la navigation</button>
            <div className="wc-card-footer">🔒 Réponse garantie sous 24h · Livraison en Tunisie</div>
          </div>
        </div>
      </div>

      {/* ── Formulaire ── */}
      <div className="wc-form-col">
        {/* Visibilité site web */}
        <div className="wc-form-section">
          <button
            type="button"
            className={`wc-listed-toggle${listed ? ' wc-listed-toggle--on' : ' wc-listed-toggle--off'}`}
            onClick={handleToggleListed}
            disabled={togglingListed}
          >
            <span className="wc-listed-track">
              <span className="wc-listed-thumb" />
            </span>
            <span className="wc-listed-label">
              <Globe size={13} />
              {listed ? 'En vente sur le site web' : 'Masqué du site web'}
            </span>
          </button>
        </div>

        <div className="wc-form-section">
          <label className="wc-label">Titre</label>
          <input className="wc-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder={product.name} />
        </div>

        <div className="wc-form-section">
          <label className="wc-label">Description</label>
          <textarea className="wc-textarea" rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Description affichée sur le site..." />
        </div>

        <div className="wc-form-section">
          <label className="wc-label">Caractéristiques</label>
          {form.features.map((f, i) => (
            <div key={i} className="wc-feature-edit-row">
              <input
                className="wc-input"
                value={f}
                onChange={e => updateFeature(i, e.target.value)}
              />
              <button className="wc-badge-del wc-feat-del" onClick={() => removeFeature(i)}>×</button>
            </div>
          ))}
          <div className="wc-add-row">
            <input
              className="wc-input"
              value={featureInput}
              onChange={e => setFeatureInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addFeature()}
              placeholder="Ex : Fournisseur: CardioLife Tunisie"
            />
            <button className="wc-add-btn" onClick={addFeature}><Plus size={14} /></button>
          </div>
        </div>

        <button className="wc-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? <span className="login-btn-spinner" /> : <><Save size={14} /> Sauvegarder la fiche</>}
        </button>
      </div>
    </div>
  )
}

/* ─── Page principale ─── */
const TABS = [
  { key: 'info',      label: 'Informations', icon: Info         },
  { key: 'stock',     label: 'Stock',        icon: History      },
  { key: 'commandes', label: 'Commandes',    icon: ShoppingCart },
  { key: 'clients',   label: 'Clients',      icon: Users        },
  { key: 'site-web',  label: 'Site Web',     icon: Globe        },
]

export default function ProductDetailPage() {
  const { id }    = useParams()
  const navigate  = useNavigate()

  const [product,               setProduct]               = useState(null)
  const [movements,             setMovements]             = useState([])
  const [loading,               setLoading]               = useState(true)
  const [mvLoading,             setMvLoading]             = useState(true)
  const [editOpen,              setEditOpen]              = useState(false)
  const [adjOpen,               setAdjOpen]               = useState(false)
  const [uploading,             setUploading]             = useState(false)
  const [deletingImg,           setDeletingImg]           = useState(null)
  const [lightboxIdx,           setLightbox]              = useState(null)
  const [activeTab,             setActiveTab]             = useState('info')
  const [viewingMovementDetail, setViewingMovementDetail] = useState(null)

  useLoadingBar(loading)

  const loadProduct = useCallback(async () => {
    setLoading(true)
    try {
      const p = await getProduct(id)
      setProduct(p)
    } catch {
      toast.error('Produit introuvable.')
      navigate('/stock')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  const loadMovements = useCallback(async () => {
    setMvLoading(true)
    try {
      const raw = await getMovements(id)
      setMovements(Array.isArray(raw) ? raw : (raw.data || []))
    } catch {
      setMovements([])
    } finally {
      setMvLoading(false)
    }
  }, [id])

  useEffect(() => { loadProduct()   }, [loadProduct])
  useEffect(() => { loadMovements() }, [loadMovements])

  useEffect(() => {
    if (lightboxIdx === null) return
    const images = product?.images || []
    function onKey(e) {
      if (e.key === 'Escape')      setLightbox(null)
      if (e.key === 'ArrowRight')  setLightbox(i => (i + 1) % images.length)
      if (e.key === 'ArrowLeft')   setLightbox(i => (i - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, product])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const updated = await uploadProductImage(id, file)
      setProduct(updated)
    } catch (err) {
      toast.error(err.message || 'Échec de l\'upload.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteImage(filename) {
    setDeletingImg(filename)
    try {
      const updated = await deleteProductImage(id, filename)
      setProduct(updated)
    } catch (err) {
      toast.error(err.message || 'Échec de la suppression.')
    } finally {
      setDeletingImg(null)
    }
  }

  if (loading || !product) {
    return (
      <div className="page-content">
        <div className="table-loading"><span className="spinner" /></div>
      </div>
    )
  }

  /* Computed stock data */
  const inStockSerials = (() => {
    const entered = new Set()
    const exited  = new Set()
    movements.forEach(mv => {
      if (mv.type === 'entree') mv.serialNumbers?.forEach(sn => entered.add(sn))
      if (mv.type === 'sortie') mv.serialNumbers?.forEach(sn => exited.add(sn))
    })
    return [...entered].filter(sn => !exited.has(sn))
  })()

  const lotsReceived = movements
    .filter(mv => mv.type === 'entree' && mv.lotNumber)
    .map(mv => ({
      lotNumber:      mv.lotNumber,
      expirationDate: mv.expirationDate,
      quantity:       mv.quantity,
    }))

  const unTrackedCount = (!mvLoading && product.requiresSerialNumber)
    ? Math.max(0, product.stock - inStockSerials.length)
    : 0

  return (
    <div className="page-content">
      {/* ── En-tête ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate('/stock')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">{product.name}</h1>
            <div className="pd-header-meta">
              <CategoryBadge category={product.category} />
              {product.reference    && <span className="cell-secondary">Réf. {product.reference}</span>}
              {product.brand        && <span className="cell-secondary">{product.brand}</span>}
              {product.compatibleModel && <span className="cell-secondary">{product.compatibleModel}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost" onClick={() => setAdjOpen(true)}>
            <SlidersHorizontal size={14} /> Ajuster le stock
          </button>
          <button className="btn btn--primary" onClick={() => setEditOpen(true)}>
            <Pencil size={14} /> Modifier
          </button>
        </div>
      </div>

      {/* ── Métriques ── */}
      <div className="pd-metrics">
        <div className="pd-metric-card">
          <div className="pd-metric-label">Stock actuel</div>
          <StockIndicator stock={product.stock} threshold={product.alertThreshold} />
        </div>
        <div className="pd-metric-card">
          <div className="pd-metric-label">Péremption</div>
          <ExpirationBadge date={product.expirationDate} />
        </div>
        <div className="pd-metric-card">
          <div className="pd-metric-label">Prix de vente</div>
          <div className="pd-metric-value">{formatPrice(product.salePrice)}</div>
        </div>
        <div className="pd-metric-card">
          <div className="pd-metric-label">Prix d'achat</div>
          <div className="pd-metric-value">{formatPrice(product.purchasePrice)}</div>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div className="pd-tabs">
        {TABS.map(t => {
          const Icon = t.icon
          const showAlert = t.key === 'stock' && unTrackedCount > 0
          return (
            <button
              key={t.key}
              className={`pd-tab${activeTab === t.key ? ' pd-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <Icon size={14} /> {t.label}
              {showAlert && <span className="pd-tab-alert"><AlertTriangle size={9} /></span>}
            </button>
          )
        })}
      </div>

      {/* ── Onglet Informations ── */}
      {activeTab === 'info' && (
        <>
          {/* Photos */}
          <div className="pd-section">
            <div className="pd-section-title">
              <ImagePlus size={14} /> Photos du produit
              <span className="pd-count">{product.images?.length || 0}</span>
            </div>
            <div className="img-gallery">
              {(product.images || []).map((filename, idx) => (
                <div key={filename} className="img-thumb">
                  <img
                    src={productImageUrl(filename)} alt={product.name}
                    className="img-thumb-clickable"
                    onClick={() => setLightbox(idx)}
                  />
                  <button
                    className="img-thumb-del"
                    title="Supprimer"
                    disabled={deletingImg === filename}
                    onClick={() => handleDeleteImage(filename)}
                  >
                    {deletingImg === filename
                      ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                      : <Trash2 size={12} />
                    }
                  </button>
                </div>
              ))}
              <label className="img-upload-btn" title="Ajouter une photo">
                {uploading
                  ? <span className="spinner" />
                  : <><ImagePlus size={22} /><span>Ajouter</span></>
                }
                <input
                  type="file" accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          </div>

          {/* Détails produit */}
          <div className="pd-section">
            <div className="pd-section-title">
              <Info size={14} /> Détails produit
            </div>
            <div className="pd-details-grid">
              {[
                { label: 'Modèle compatible', value: product.compatibleModel },
                { label: 'N° de lot',         value: product.lotNumber },
                { label: 'Fournisseur',       value: product.supplier },
                { label: 'Seuil d\'alerte',   value: product.alertThreshold != null ? `${product.alertThreshold} unités` : null },
              ].map(({ label, value }) => (
                <div key={label} className="pd-detail-item">
                  <div className="pd-detail-label">{label}</div>
                  <div className="pd-detail-value">{value || <span className="cell-muted">—</span>}</div>
                </div>
              ))}
              {product.notes && (
                <div className="pd-detail-item pd-detail-item--full">
                  <div className="pd-detail-label">Notes</div>
                  <div className="pd-detail-value">{product.notes}</div>
                </div>
              )}
            </div>
          </div>

          {product.description && (
            <div className="pd-section">
              <div className="pd-section-title">
                <FileText size={14} /> Description produit
              </div>
              <RichText html={product.description} />
            </div>
          )}
        </>
      )}

      {/* ── Onglet Stock ── */}
      {activeTab === 'stock' && (
        <>
          {/* Stock actuel */}
          <div className="pd-section">
            <div className="pd-section-title">
              <SlidersHorizontal size={14} /> Stock actuel
              <button
                className="btn btn--ghost btn--sm pd-section-action"
                onClick={() => setAdjOpen(true)}
              >
                <SlidersHorizontal size={13} /> Ajuster
              </button>
            </div>

            <div className="pd-stock-current">
              <div className="pd-stock-qty-block">
                <span className="pd-stock-big-num" style={{
                  color: product.stock === 0 ? 'var(--red-500)'
                    : product.stock <= product.alertThreshold ? 'var(--amber-600)'
                    : 'var(--green-600)'
                }}>
                  {product.stock}
                </span>
                <span className="pd-stock-big-label">unité{product.stock !== 1 ? 's' : ''} en stock</span>
                {product.stock === 0 && (
                  <span className="stock-status-chip stock-status-chip--out" style={{ marginTop: 4 }}>Épuisé</span>
                )}
                {product.stock > 0 && product.stock <= product.alertThreshold && (
                  <span className="stock-status-chip stock-status-chip--low" style={{ marginTop: 4 }}>Stock faible</span>
                )}
              </div>

              {(product.requiresSerialNumber || product.requiresLotNumber) && (
                <div className="pd-stock-trace">
                  {mvLoading ? (
                    <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'center' }}>
                      <span className="spinner" />
                    </div>
                  ) : (
                    <>
                      {product.requiresSerialNumber && (
                        <div className="pd-trace-block">
                          <div className="pd-trace-label">
                            <Hash size={12} /> Numéros de série en stock
                            <span className="pd-count">{inStockSerials.length}</span>
                          </div>
                          {inStockSerials.length === 0 ? (
                            <p className="pd-trace-empty">Aucun numéro de série en stock.</p>
                          ) : (
                            <div className="mv-serials-list" style={{ marginTop: 8 }}>
                              {inStockSerials.map((sn, i) => (
                                <span key={i} className="mv-serial-chip">{sn}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {product.requiresLotNumber && (
                        <div className="pd-trace-block">
                          <div className="pd-trace-label">
                            <Layers size={12} /> Lots reçus
                            <span className="pd-count">{lotsReceived.length}</span>
                          </div>
                          {lotsReceived.length === 0 ? (
                            <p className="pd-trace-empty">Aucun lot enregistré.</p>
                          ) : (
                            <div className="mv-lots-list" style={{ marginTop: 8 }}>
                              {lotsReceived.map((lot, i) => (
                                <div key={i} className="mv-lot-row">
                                  <span className="mv-lot-chip">{lot.lotNumber}</span>
                                  <span className="mv-lot-qty">+{lot.quantity}</span>
                                  {lot.expirationDate && (
                                    <span className="mv-lot-expiry">exp. {formatDate(lot.expirationDate)}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Alerte séries manquantes */}
          {unTrackedCount > 0 && (
            <div className="pd-section">
              <div className="pd-serial-warn-banner">
                <AlertTriangle size={14} />
                <div>
                  <strong>{unTrackedCount} unité{unTrackedCount > 1 ? 's' : ''} sans numéro de série renseigné</strong>
                  <span>Ce produit requiert un numéro de série mais {unTrackedCount} unité{unTrackedCount > 1 ? 's' : ''} en stock n'en ont pas.</span>
                </div>
                <button className="btn btn--sm btn--primary" onClick={() => setAdjOpen(true)}>
                  Saisir les séries
                </button>
              </div>
            </div>
          )}

          {/* Mouvements de stock */}
          <div className="pd-section">
            <div className="pd-section-title">
              <History size={14} /> Mouvements de stock
              {!mvLoading && <span className="pd-count">{movements.length}</span>}
            </div>
            {mvLoading ? (
              <div className="table-loading" style={{ padding: '32px 0' }}><span className="spinner" /></div>
            ) : movements.length === 0 ? (
              <div className="pd-empty">
                <History size={28} color="var(--gray-300)" />
                <p>Aucun mouvement enregistré pour ce produit.</p>
              </div>
            ) : (
              <div className="mv-list">
                {movements.map(mv => (
                  <MovementRow
                    key={mv._id}
                    mv={mv}
                    onClick={() => setViewingMovementDetail(mv)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Onglet Commandes ── */}
      {activeTab === 'commandes' && (
        <div className="pd-section">
          <div className="pd-section-title">
            <ShoppingCart size={14} /> Commandes
          </div>
          <div className="pd-empty">
            <ShoppingCart size={28} color="var(--gray-300)" />
            <p>Aucune commande enregistrée pour ce produit.</p>
            <span className="pd-empty-note">La gestion des commandes sera disponible prochainement.</span>
          </div>
        </div>
      )}

      {/* ── Onglet Clients ── */}
      {activeTab === 'clients' && (
        <div className="pd-section">
          <div className="pd-section-title">
            <Users size={14} /> Clients propriétaires
          </div>
          <div className="pd-empty">
            <Users size={28} color="var(--gray-300)" />
            <p>Aucun client associé à ce produit.</p>
            <span className="pd-empty-note">L'association clients-produits sera disponible prochainement.</span>
          </div>
        </div>
      )}

      {/* ── Onglet Site Web ── */}
      {activeTab === 'site-web' && (
        <div className="pd-section">
          <div className="pd-section-title">
            <Globe size={14} /> Fiche site web
          </div>
          <WebCardTab
            product={product}
            onSaved={(updated) => { if (updated) setProduct(updated) }}
          />
        </div>
      )}

      {/* ── Modals ── */}
      {editOpen && (
        <ProductModal
          product={product}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => { setEditOpen(false); updated ? setProduct(updated) : loadProduct() }}
        />
      )}
      {adjOpen && (
        <StockAdjustModal
          product={product}
          onClose={() => setAdjOpen(false)}
          onDone={() => { setAdjOpen(false); loadProduct(); loadMovements() }}
        />
      )}
      {viewingMovementDetail && (
        <MovementDetailModal
          movement={viewingMovementDetail}
          onClose={() => setViewingMovementDetail(null)}
        />
      )}

      {lightboxIdx !== null && (() => {
        const images = product.images || []
        const src    = productImageUrl(images[lightboxIdx])
        const multi  = images.length > 1
        return (
          <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
            <button className="lightbox-close" onClick={() => setLightbox(null)}><X size={20} /></button>
            {multi && (
              <button
                className="lightbox-nav lightbox-nav--prev"
                onClick={e => { e.stopPropagation(); setLightbox(i => (i - 1 + images.length) % images.length) }}
              >
                <ChevronLeft size={28} />
              </button>
            )}
            <img
              className="lightbox-img"
              src={src}
              alt={product.name}
              onClick={e => e.stopPropagation()}
            />
            {multi && (
              <button
                className="lightbox-nav lightbox-nav--next"
                onClick={e => { e.stopPropagation(); setLightbox(i => (i + 1) % images.length) }}
              >
                <ChevronRight size={28} />
              </button>
            )}
            {multi && (
              <div className="lightbox-counter">{lightboxIdx + 1} / {images.length}</div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
