import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Plus, Search, Pencil, Trash2, X, AlertTriangle,
  Package, ChevronLeft, ChevronRight, RotateCcw, Trash, Archive,
  TrendingUp, TrendingDown, SlidersHorizontal,
  Clock, AlertCircle, CheckCircle2, History, User, Hash, Layers,
} from 'lucide-react'
import {
  getProducts, getProductStats, getAllMovements,
  adjustStock, archiveProduct, restoreProduct, destroyProduct, getMovements,
  productImageUrl, getSuppliers, getBrands,
} from '../api/products'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ProductModal from '../components/ProductModal'
import { PRODUCT_CATEGORIES as CATEGORIES, CATEGORY_MAP as CAT_MAP } from '../constants/categories'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/* ─── Helpers visuels ─── */
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
  if (days < 0)   return { level: 'expired', label: 'Expiré',    days }
  if (days <= 30) return { level: 'urgent',  label: `${days}j`,  days }
  if (days <= 90) return { level: 'soon',    label: `${days}j`,  days }
  return { level: 'ok', label: new Date(dateStr).toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' }), days }
}

function formatDate(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatPrice(val) {
  if (val == null || val === '') return '—'
  return `${Number(val).toLocaleString('fr-FR')} DT`
}

/* ─── Sort icon ─── */
function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <span style={{ opacity: .25, fontSize: 10, marginLeft: 3 }}>⇅</span>
  return <span style={{ fontSize: 10, marginLeft: 3, color: 'var(--orange-500)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
}

/* ─── Composant badge catégorie ─── */
function CategoryBadge({ category }) {
  const cat = CAT_MAP[category]
  if (!cat) return <span className="type-badge">{category}</span>
  return <span className={`cat-badge ${cat.color}`}>{cat.label}</span>
}

/* ─── Composant indicateur stock ─── */
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

/* ─── Composant badge péremption ─── */
function ExpirationBadge({ date }) {
  const exp = getExpirationStatus(date)
  if (!exp) return <span className="cell-muted">—</span>
  return (
    <div className="exp-cell">
      <span className="exp-date">{formatDate(date)}</span>
      <span className={`exp-badge exp-badge--${exp.level}`}>
        {exp.level === 'expired' && <AlertTriangle size={10} />}
        {exp.level === 'urgent'  && <Clock size={10} />}
        {exp.level === 'soon'    && <Clock size={10} />}
        {exp.level === 'ok'      && <CheckCircle2 size={10} />}
        {exp.level === 'expired' ? 'Expiré' : exp.level === 'ok' ? 'OK' : `${exp.days}j`}
      </span>
    </div>
  )
}

/* ─── Modal ajustement de stock ─── */
function StockAdjustModal({ product, onClose, onDone }) {
  const navigate = useNavigate()
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

  const isSortieSerial = type === 'sortie' && product.requiresSerialNumber
  const needsSerialEntry = type === 'entree' && product.requiresSerialNumber
  const needsLotEntry    = product.requiresLotNumber && type === 'entree'

  const qty = isSortieSerial
    ? selectedSerials.length
    : Number(quantity) || 0

  const newStock = type === 'entree'
    ? product.stock + qty
    : product.stock - qty

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
      const finalSerials = isSortieSerial
        ? selectedSerials
        : needsSerialEntry ? serialLines : []
      const finalLot = type === 'sortie' && product.requiresLotNumber
        ? selectedLot
        : needsLotEntry && lotNumber ? lotNumber : undefined

      await adjustStock(product._id, {
        type, quantity: qty, reason,
        serialNumbers: finalSerials,
        lotNumber: finalLot || undefined,
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
                { value: 'entree', icon: TrendingUp,   label: 'Entrée', cls: 'entree' },
                { value: 'sortie', icon: TrendingDown,  label: 'Sortie', cls: 'sortie' },
              ].map(({ value, icon: Icon, label, cls }) => (
                <button
                  key={value} type="button"
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
              <input
                className="form-input form-input--plain"
                type="number" min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="Quantité…"
                required autoFocus
              />
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
                        {serialSearch ? 'Aucun résultat.' : 'Tous les numéros sont sélectionnés.'}
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
                    onClick={() => { onClose(); navigate(`/stock/${product._id}`) }}
                  >
                    <Hash size={12} /> Renseigner les numéros de série disponibles
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
            <input
              className="form-input form-input--plain"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="ex. Livraison fournisseur, Installation client…"
            />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || qty <= 0 || newStock < 0}
            >
              {loading ? <span className="login-btn-spinner" /> : 'Valider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Confirmation archivage ─── */
function ArchiveConfirm({ product, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function confirm() {
    setLoading(true)
    try {
      await archiveProduct(product._id)
      toast.success('Produit archivé.')
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Archiver le produit</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Voulez-vous archiver <strong>{product.name}</strong> ?<br />
            Il ne sera plus visible dans le stock actif mais pourra être restauré.
          </p>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={confirm} disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Archiver'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Confirmation suppression définitive ─── */
function DestroyConfirm({ product, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [confirm, setConfirm] = useState('')

  async function handleDestroy() {
    setLoading(true)
    try {
      await destroyProduct(product._id)
      toast.success('Produit supprimé définitivement.')
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Suppression définitive</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="destroy-warning">
            <AlertTriangle size={18} />
            <p>Cette action est <strong>irréversible</strong>. L'historique des mouvements de ce produit sera également supprimé.</p>
          </div>
          <p className="delete-confirm-text" style={{ marginTop: 12 }}>
            Tapez le nom du produit pour confirmer : <strong>{product.name}</strong>
          </p>
          <input
            className="form-input form-input--plain"
            style={{ marginTop: 10 }}
            placeholder={product.name}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          {error && <div className="login-error" style={{ marginTop: 8 }}><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button
              className="btn btn--danger"
              onClick={handleDestroy}
              disabled={loading || confirm !== product.name}
            >
              {loading ? <span className="login-btn-spinner" /> : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Modal détail d'un mouvement ─── */
function MovementDetailModal({ movement, onClose }) {
  const isEntree  = movement.type === 'entree'
  const isSortie  = movement.type === 'sortie'
  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : SlidersHorizontal
  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : 'Correction'
  const sign      = isEntree ? '+' : isSortie ? '-' : '→'
  const hasSerials = (movement.serialNumbers?.length ?? 0) > 0
  const hasLot     = !!movement.lotNumber

  function fmtDT(d) {
    if (!d) return '—'
    return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

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
                <span>{fmtDT(movement.createdAt)}</span>
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

/* ─── Modal stock détaillé d'un produit ─── */
function StockDetailModal({ product, onClose, onAdjust }) {
  const [movements, setMovements] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    getMovements(product._id)
      .then(raw => setMovements(Array.isArray(raw) ? raw : (raw.data || [])))
      .catch(() => setMovements([]))
      .finally(() => setLoading(false))
  }, [product._id])

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
    .map(mv => ({ lotNumber: mv.lotNumber, expirationDate: mv.expirationDate, quantity: mv.quantity }))

  const showSerials = product.requiresSerialNumber
  const showLots    = product.requiresLotNumber

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Stock détaillé</h2>
            <div className="modal-subtitle">{product.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="sd-summary">
            <div className="sd-stock-num">{product.stock}</div>
            <div className="sd-stock-label">unité{product.stock !== 1 ? 's' : ''} en stock</div>
          </div>

          {loading ? (
            <div className="table-loading" style={{ padding: 32 }}><span className="spinner" /></div>
          ) : (
            <>
              {showSerials && (
                <div className="mv-detail-section">
                  <div className="mv-detail-section-title">
                    <Hash size={13} /> Numéros de série en stock ({inStockSerials.length})
                  </div>
                  {inStockSerials.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucun numéro de série en stock.</p>
                  ) : (
                    <div className="mv-serials-list">
                      {inStockSerials.map((sn, i) => <span key={i} className="mv-serial-chip">{sn}</span>)}
                    </div>
                  )}
                </div>
              )}

              {showLots && (
                <div className="mv-detail-section">
                  <div className="mv-detail-section-title">
                    <Layers size={13} /> Lots reçus ({lotsReceived.length})
                  </div>
                  {lotsReceived.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucun lot enregistré.</p>
                  ) : (
                    <div className="mv-lots-list">
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

              {!showSerials && !showLots && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  Ce produit n'a pas de traçabilité par numéro de série ou de lot.
                </p>
              )}
            </>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Fermer</button>
            <button type="button" className="btn btn--primary" onClick={onAdjust}>
              <SlidersHorizontal size={14} /> Ajuster le stock
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Modal mouvements de stock ─── */
function MovementsModal({ product, onClose }) {
  const [movements, setMovements] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    getMovements(product._id)
      .then(raw => setMovements(Array.isArray(raw) ? raw : (raw.data || [])))
      .catch(() => setMovements([]))
      .finally(() => setLoading(false))
  }, [product._id])

  function formatDateTime(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Mouvements de stock</h2>
            <div className="modal-subtitle">{product.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ padding: 0, gap: 0, maxHeight: 480 }}>
          {loading ? (
            <div className="table-loading" style={{ padding: 48 }}><span className="spinner" /></div>
          ) : movements.length === 0 ? (
            <div className="pd-empty">
              <History size={28} color="var(--gray-300)" />
              <p>Aucun mouvement enregistré pour ce produit.</p>
            </div>
          ) : (
            <div className="mv-list">
              {movements.map(mv => {
                const isEntree = mv.type === 'entree'
                const isSortie = mv.type === 'sortie'
                const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
                const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : SlidersHorizontal
                const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : 'Correction'
                const sign      = isEntree ? '+' : isSortie ? '-' : '→'
                return (
                  <div key={mv._id} className="mv-row">
                    <div className={`mv-badge mv-badge--${cls}`}>
                      <TypeIcon size={12} />
                      {sign}{mv.quantity}
                    </div>
                    <div className="mv-info">
                      <div className="mv-type-line">
                        <span className="mv-type-label">{typeLabel}</span>
                        {mv.reason && <span className="mv-reason">— {mv.reason}</span>}
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Page principale ─── */
const LIMIT = 50

export default function StockPage() {
  const navigate = useNavigate()

  const [tab,              setTab]              = useState('active')
  const [category,         setCategory]         = useState('')
  const [brandFilter,      setBrandFilter]      = useState('')
  const [supplierFilter,   setSupplierFilter]   = useState('')
  const [products,         setProducts]         = useState([])
  const [stats,            setStats]            = useState(null)
  const [total,            setTotal]            = useState(0)
  const [page,             setPage]             = useState(1)
  const [search,           setSearch]           = useState('')
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState('')
  const [modal,            setModal]            = useState(null)
  const [adjusting,        setAdjusting]        = useState(null)
  const [archiving,        setArchiving]        = useState(null)
  const [destroying,       setDestroying]       = useState(null)
  const [viewingMovements,      setViewingMovements]      = useState(null)
  const [viewingMovementDetail, setViewingMovementDetail] = useState(null)
  const [viewingStockDetail,    setViewingStockDetail]    = useState(null)
  const [allMovements,     setAllMovements]     = useState([])
  const [mvTotal,          setMvTotal]          = useState(0)
  const [mvPage,           setMvPage]           = useState(1)
  const [mvLoading,        setMvLoading]        = useState(false)
  const [allBrands,        setAllBrands]        = useState([])
  const [allSuppliers,     setAllSuppliers]     = useState([])
  const [statFilter,       setStatFilter]       = useState(null)

  // Tri colonnes
  const [sortField, setSortField] = useState(null)
  const [sortDir,   setSortDir]   = useState('asc')

  useLoadingBar(loading)

  const isArchived   = tab === 'archived'
  const isMovements  = tab === 'movements'
  const totalPages   = Math.ceil(total / LIMIT)
  const mvTotalPages = Math.ceil(mvTotal / LIMIT)

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const sortedProducts = useMemo(() => {
    if (!sortField) return products
    return [...products].sort((a, b) => {
      let va, vb
      if      (sortField === 'name')       { va = (a.name || '').toLowerCase();       vb = (b.name || '').toLowerCase() }
      else if (sortField === 'category')   { va = a.category || '';                   vb = b.category || '' }
      else if (sortField === 'stock')      { va = a.stock ?? 0;                       vb = b.stock ?? 0 }
      else if (sortField === 'expiration') {
        va = a.expirationDate ? new Date(a.expirationDate).getTime() : Infinity
        vb = b.expirationDate ? new Date(b.expirationDate).getTime() : Infinity
      }
      else if (sortField === 'brand')        { va = (a.brand || '').toLowerCase();      vb = (b.brand || '').toLowerCase() }
      else if (sortField === 'tracabilite') {
        va = a.requiresSerialNumber ? 2 : a.requiresLotNumber ? 1 : 0
        vb = b.requiresSerialNumber ? 2 : b.requiresLotNumber ? 1 : 0
      }
      else if (sortField === 'price')      { va = a.salePrice ?? -Infinity;           vb = b.salePrice ?? -Infinity }
      else return 0
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [products, sortField, sortDir])

  useEffect(() => {
    getBrands().then(setAllBrands).catch(() => {})
    getSuppliers().then(setAllSuppliers).catch(() => {})
  }, [])

  const fetchStats = useCallback(async () => {
    try { setStats(await getProductStats()) } catch (_) {}
  }, [])

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { page, limit: LIMIT, archived: isArchived ? 'true' : 'false' }
      if (search)                        params.search       = search
      if (category)                      params.category     = category
      if (brandFilter)                   params.brand        = brandFilter
      if (supplierFilter)                params.supplier     = supplierFilter
      if (statFilter === 'lowStock')     params.lowStock     = 'true'
      if (statFilter === 'expiringSoon') params.expiringSoon = 'true'
      if (statFilter === 'expired')      params.expired      = 'true'
      const res = await getProducts(params)
      setProducts(res.data)
      setTotal(res.total)
    } catch (err) {
      const msg = formatApiError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [page, search, isArchived, category, brandFilter, supplierFilter, statFilter])

  const fetchAllMovements = useCallback(async () => {
    setMvLoading(true)
    try {
      const res = await getAllMovements({ page: mvPage, limit: LIMIT })
      setAllMovements(Array.isArray(res) ? res : (res.data || []))
      setMvTotal(res.total || 0)
    } catch (_) {
      setAllMovements([])
    } finally {
      setMvLoading(false)
    }
  }, [mvPage])

  useEffect(() => { fetchStats() },    [fetchStats])
  useEffect(() => { if (!isMovements) fetchProducts() }, [fetchProducts, isMovements])
  useEffect(() => { if (isMovements)  fetchAllMovements() }, [isMovements, fetchAllMovements])
  useEffect(() => { setPage(1) },   [search, tab, category, statFilter])
  useEffect(() => { setMvPage(1) }, [tab])

  async function handleRestore(product) {
    try {
      await restoreProduct(product._id)
      toast.success(`${product.name} restauré.`)
      fetchProducts()
      fetchStats()
    } catch (err) { toast.error(formatApiError(err)) }
  }

  function handleSaved()     { setModal(null);      fetchProducts(); fetchStats() }
  function handleAdjusted()  { setAdjusting(null);  fetchProducts(); fetchStats() }
  function handleArchived()  { setArchiving(null);  fetchProducts(); fetchStats() }
  function handleDestroyed() { setDestroying(null); fetchProducts(); fetchStats() }

  /* ── Stats cards ── */
  const statCards = stats ? [
    { icon: Package,       label: 'Total produits',    value: stats.total,        sub: 'en catalogue',              color: 'var(--orange-500)', bg: 'var(--orange-50)', filter: null },
    { icon: AlertCircle,   label: 'Stock critique',    value: stats.lowStock,     sub: 'en dessous du seuil',       color: 'var(--amber-600)',  bg: 'var(--amber-50)',  alert: stats.lowStock > 0,    filter: 'lowStock' },
    { icon: Clock,         label: 'Expirent bientôt', value: stats.expiringSoon, sub: 'dans les 60 prochains jours', color: 'var(--blue-600)', bg: 'var(--blue-50)',   alert: stats.expiringSoon > 0, filter: 'expiringSoon' },
    { icon: AlertTriangle, label: 'Produits expirés', value: stats.expired,      sub: 'à retirer du stock',         color: 'var(--red-600)',   bg: 'var(--red-50)',    alert: stats.expired > 0,     filter: 'expired' },
  ] : []

  const thSort = (field, label, extraStyle = {}) => (
    <th onClick={() => toggleSort(field)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...extraStyle }}>
      {label}<SortIcon field={field} sortField={sortField} sortDir={sortDir} />
    </th>
  )

  return (
    <div className="page-content page-content--table-scroll">

      {/* ── En-tête ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock & Produits</h1>
          <p className="page-subtitle">
            {isMovements
              ? `${mvTotal} mouvement${mvTotal !== 1 ? 's' : ''} enregistré${mvTotal !== 1 ? 's' : ''}`
              : `${total} produit${total !== 1 ? 's' : ''} ${isArchived ? 'archivés' : 'en catalogue'}`
            }
          </p>
        </div>
        {!isMovements && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn--ghost${isArchived ? ' btn--ghost-active' : ''}`}
              onClick={() => { setTab(isArchived ? 'active' : 'archived'); setCategory(''); setBrandFilter(''); setSupplierFilter(''); setSearch(''); setStatFilter(null) }}
            >
              <Archive size={14} /> {isArchived ? '← Stock actif' : 'Archivés'}
            </button>
            {!isArchived && (
              <button className="btn btn--primary" onClick={() => setModal('create')}>
                <Plus size={15} /> Nouveau produit
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Onglets navigation ── */}
      <div className="stock-tabs">
        {[
          { value: 'active',    label: 'Stock actif'          },
          { value: 'movements', label: 'Mouvements de stocks' },
        ].map(t => (
          <button
            key={t.value}
            className={`stock-tab${tab === t.value ? ' stock-tab--active' : ''}`}
            onClick={() => { setTab(t.value); setCategory(''); setBrandFilter(''); setSupplierFilter(''); setSearch(''); setStatFilter(null) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cartes de statistiques ── */}
      {tab === 'active' && stats && (
        <div className="stock-stats-grid">
          {statCards.map(card => {
            const Icon = card.icon
            const isActive = card.filter !== null && statFilter === card.filter
            return (
              <div
                key={card.label}
                className={`stock-stat-card${card.alert ? ' stock-stat-card--alert' : ''}${isActive ? ' stock-stat-card--active' : ''}`}
                style={{
                  ...(card.alert ? { color: card.color } : {}),
                  ...(isActive ? { background: card.bg, boxShadow: `0 0 0 2px ${card.color}`, borderColor: 'transparent' } : {}),
                  cursor: 'pointer',
                }}
                onClick={() => setStatFilter(statFilter === card.filter ? null : card.filter)}
              >
                <div className="stock-stat-icon" style={{ background: card.bg }}>
                  <Icon size={18} color={card.color} />
                </div>
                <div className="stock-stat-body">
                  <div className="stock-stat-value" style={{ color: card.alert ? card.color : 'var(--text-primary)' }}>
                    {card.value}
                  </div>
                  <div className="stock-stat-label">{card.label}</div>
                  <div className="stock-stat-sub">{card.sub}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Barre de recherche + filtres ── */}
      {!isMovements && (
        <div className="table-toolbar">
          <div className="search-wrap">
            <Search size={14} className="search-icon" />
            <input
              className="search-input"
              placeholder="Rechercher par nom, référence, marque…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>
                <X size={13} />
              </button>
            )}
          </div>
          <select className="cat-filter-select" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Toutes catégories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {allBrands.length > 0 && (
            <select className="cat-filter-select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
              <option value="">Toutes marques</option>
              {allBrands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {allSuppliers.length > 0 && (
            <select className="cat-filter-select" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
              <option value="">Tous fournisseurs</option>
              {allSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      {/* ── Tableau produits ── */}
      {!isMovements && (
        <div className="table-wrap">
          {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

          {loading ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : products.length === 0 ? (
            <div className="table-empty">
              <Package size={36} color="var(--gray-300)" />
              <p>
                {search
                  ? 'Aucun résultat pour cette recherche.'
                  : isArchived
                    ? 'Aucun produit archivé.'
                    : 'Aucun produit en stock.'}
              </p>
              {!search && !isArchived && (
                <button className="btn btn--primary" onClick={() => setModal('create')}>
                  <Plus size={14} /> Ajouter le premier produit
                </button>
              )}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  {thSort('name',        'Produit',          { minWidth: 320 })}
                  {thSort('category',   'Catégorie',        { width: 130 })}
                  {thSort('brand',      'Marque / Modèle',  { width: 160 })}
                  {thSort('tracabilite','Traçabilité',      { width: 110 })}
                  {thSort('stock',      'Stock')}
                  {thSort('expiration', 'Péremption')}
                  {thSort('price',      'Prix vente')}
                  <th style={{ width: isArchived ? 100 : 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map(p => (
                  <tr key={p._id} className={isArchived ? 'row--archived' : ''}>
                    {/* Cellule produit — toute la zone est cliquable */}
                    <td
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/stock/${p._id}`)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p.images?.length > 0
                          ? <img src={productImageUrl(p.images[0])} alt="" className="product-list-thumb" />
                          : <div className="product-list-thumb product-list-thumb--empty">
                              <Package size={14} color="var(--gray-300)" />
                            </div>
                        }
                        <div>
                          <div className="cell-primary">{p.name}</div>
                          {p.reference && <div className="cell-secondary">Réf. {p.reference}</div>}
                        </div>
                      </div>
                    </td>
                    <td><CategoryBadge category={p.category} /></td>
                    <td>
                      {p.brand && <div className="cell-primary" style={{ fontSize: 13 }}>{p.brand}</div>}
                      {p.compatibleModel && <div className="cell-secondary">{p.compatibleModel}</div>}
                      {!p.brand && !p.compatibleModel && <span className="cell-muted">—</span>}
                    </td>
                    <td>
                      {p.requiresSerialNumber || p.requiresLotNumber ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {p.requiresSerialNumber && <span className="track-badge">N° série</span>}
                          {p.requiresLotNumber    && <span className="track-badge track-badge--lot">N° lot</span>}
                        </div>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="stock-cell-clickable" onClick={() => setViewingStockDetail(p)} title="Voir le détail du stock">
                        <StockIndicator stock={p.stock} threshold={p.alertThreshold} />
                      </div>
                    </td>
                    <td><ExpirationBadge date={p.expirationDate} /></td>
                    <td className="cell-muted">{formatPrice(p.salePrice)}</td>
                    <td>
                      <div className="row-actions">
                        {isArchived ? (
                          <>
                            <button className="action-btn action-btn--restore" title="Restaurer" onClick={() => handleRestore(p)}>
                              <RotateCcw size={14} />
                            </button>
                            <button className="action-btn action-btn--destroy" title="Supprimer définitivement" onClick={() => setDestroying(p)}>
                              <Trash size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="action-btn action-btn--history" title="Mouvements" onClick={() => setViewingMovements(p)}>
                              <History size={14} />
                            </button>
                            <button className="action-btn action-btn--stock" title="Ajuster le stock" onClick={() => setAdjusting(p)}>
                              <SlidersHorizontal size={14} />
                            </button>
                            <button className="action-btn action-btn--edit" title="Modifier" onClick={() => setModal(p)}>
                              <Pencil size={14} />
                            </button>
                            <button className="action-btn action-btn--delete" title="Archiver" onClick={() => setArchiving(p)}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Pagination produits ── */}
      {!isMovements && totalPages > 1 && (
        <div className="pagination">
          <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="pag-info">Page {page} / {totalPages}</span>
          <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* ── Tableau mouvements (tous produits) ── */}
      {isMovements && (
        <div className="table-wrap">
          {mvLoading ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : allMovements.length === 0 ? (
            <div className="table-empty">
              <History size={36} color="var(--gray-300)" />
              <p>Aucun mouvement de stock enregistré.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th>Mouvement</th>
                  <th>Avant → Après</th>
                  <th>Motif</th>
                  <th>Par</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {allMovements.map(mv => {
                  const isEntree  = mv.type === 'entree'
                  const isSortie  = mv.type === 'sortie'
                  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
                  const sign      = isEntree ? '+' : isSortie ? '-' : '→'
                  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : SlidersHorizontal
                  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : 'Correction'
                  const prod      = mv.product
                  return (
                    <tr key={mv._id} className="mv-row--clickable" onClick={() => setViewingMovementDetail(mv)} title="Voir le détail">
                      <td>
                        {prod ? (
                          <>
                            <div className="cell-primary cell-link" onClick={e => { e.stopPropagation(); navigate(`/stock/${prod._id || prod}`) }}>
                              {prod.name || '—'}
                            </div>
                            {prod.reference && <div className="cell-secondary">Réf. {prod.reference}</div>}
                          </>
                        ) : <span className="cell-muted">—</span>}
                      </td>
                      <td>
                        {prod?.category
                          ? <CategoryBadge category={prod.category} />
                          : <span className="cell-muted">—</span>
                        }
                      </td>
                      <td>
                        <div className={`mv-badge mv-badge--${cls}`} style={{ marginBottom: 2 }}>
                          <TypeIcon size={12} /> {sign}{mv.quantity}
                        </div>
                        <div className="cell-secondary">{typeLabel}</div>
                      </td>
                      <td>
                        {mv.previousStock != null && mv.newStock != null
                          ? <span className="mv-stocks">{mv.previousStock} → {mv.newStock}</span>
                          : <span className="cell-muted">—</span>
                        }
                      </td>
                      <td className="cell-muted">{mv.reason || '—'}</td>
                      <td className="cell-muted">{mv.createdBy?.fullName || mv.createdBy?.username || '—'}</td>
                      <td className="cell-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {mv.createdAt
                          ? new Date(mv.createdAt).toLocaleString('fr-FR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Pagination mouvements ── */}
      {isMovements && mvTotalPages > 1 && (
        <div className="pagination">
          <button className="pag-btn" disabled={mvPage === 1} onClick={() => setMvPage(p => p - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="pag-info">Page {mvPage} / {mvTotalPages}</span>
          <button className="pag-btn" disabled={mvPage === mvTotalPages} onClick={() => setMvPage(p => p + 1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* ── Modals ── */}
      {(modal === 'create' || modal?._id) && (
        <ProductModal
          product={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {adjusting && (
        <StockAdjustModal product={adjusting} onClose={() => setAdjusting(null)} onDone={handleAdjusted} />
      )}
      {archiving && (
        <ArchiveConfirm product={archiving} onClose={() => setArchiving(null)} onDone={handleArchived} />
      )}
      {destroying && (
        <DestroyConfirm product={destroying} onClose={() => setDestroying(null)} onDone={handleDestroyed} />
      )}
      {viewingMovements && (
        <MovementsModal product={viewingMovements} onClose={() => setViewingMovements(null)} />
      )}
      {viewingMovementDetail && (
        <MovementDetailModal movement={viewingMovementDetail} onClose={() => setViewingMovementDetail(null)} />
      )}
      {viewingStockDetail && (
        <StockDetailModal
          product={viewingStockDetail}
          onClose={() => setViewingStockDetail(null)}
          onAdjust={() => {
            const p = viewingStockDetail
            setViewingStockDetail(null)
            setAdjusting(p)
          }}
        />
      )}
    </div>
  )
}
