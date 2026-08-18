import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Plus, Search, Pencil, Trash2, X, AlertTriangle, ArrowLeft,
  Package, ChevronLeft, ChevronRight, RotateCcw, Trash, Archive,
  TrendingUp, TrendingDown, SlidersHorizontal,
  History, User, Hash, Layers, Boxes, Clock,
  MoreVertical, Eye, PackageOpen, LayoutGrid, List, FileSpreadsheet,
} from 'lucide-react'
import {
  getProducts, getAllMovements,
  adjustStock, archiveProduct, restoreProduct, destroyProduct, getMovements,
  productImageUrl,
} from '../api/products'
import { getProductCategories } from '../api/productCategories'
import { getStockModels } from '../api/productItems'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ProductModal from '../components/ProductModal'
import ParcExpiryTab from '../components/ParcExpiryTab'
import { categoryIcon } from '../constants/categoryIcons'

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
            if (mv.type === 'entree' || mv.type === 'serialisation') mv.serialNumbers?.forEach(sn => entered.add(sn))
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
  const isSerial  = movement.type === 'serialisation'
  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : isSerial ? Hash : SlidersHorizontal
  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : isSerial ? 'Saisie de séries' : 'Correction'
  const sign      = isEntree ? '+' : isSortie ? '-' : isSerial ? '' : '→'
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
                const isSerial = mv.type === 'serialisation'
                const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
                const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : isSerial ? Hash : SlidersHorizontal
                const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : isSerial ? 'Saisie de séries' : 'Correction'
                const sign      = isEntree ? '+' : isSortie ? '-' : isSerial ? '' : '→'
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

/* ─── Vue « catégories » : une carte par catégorie configurée ─── */
function CategoryGrid({ categories, onPick }) {
  if (categories.length === 0) {
    return (
      <div className="table-empty">
        <Package size={36} color="var(--gray-300)" />
        <p>Aucune catégorie configurée. Ajoutez-en dans Paramètres → Catégories produits.</p>
      </div>
    )
  }

  return (
    <div className="cat-grid">
      {categories.map(c => {
        const Icon = categoryIcon(c.icon)
        const st   = c.stats || {}
        return (
          <button key={c._id} className={`cat-card cat-card--${c.color}`} onClick={() => onPick(c)}>
            {/* Icône en filigrane : donne du volume à la carte sans charger le contenu */}
            <Icon className="cat-card-ghost" size={132} strokeWidth={0.9} />

            <div className="cat-card-top">
              <span className="cat-card-media">
                {c.image
                  ? <img src={c.image} alt="" className="cat-card-img" />
                  : <Icon size={24} strokeWidth={1.9} />}
              </span>
              {st.lowStock > 0 && (
                <span className="cat-card-alert">{st.lowStock} en alerte</span>
              )}
            </div>

            <div className="cat-card-name">{c.name}</div>

            <div className="cat-card-figures">
              <span className="cat-card-units">{st.units ?? 0}</span>
              <span className="cat-card-units-label">
                article{(st.units ?? 0) !== 1 ? 's' : ''} en stock
              </span>
            </div>

            <div className="cat-card-foot">
              <span className="cat-card-ref">
                {st.products ?? 0} référence{(st.products ?? 0) !== 1 ? 's' : ''}
              </span>
              <span className="cat-card-go">
                Ouvrir <ChevronRight size={14} />
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ─── Vue « modèles » (catégories à suivi unitaire) ───────────────────────
   On n'ouvre pas la liste des appareils d'emblée : un parc de défibrillateurs
   se lit d'abord modèle par modèle (ZOLL AED Plus — 18), le détail exemplaire
   par exemplaire venant au cran suivant. */
function ModelRow({ model, category, onOpen, onMenu }) {
  const s = model.summary || {}
  const hasImage = model.images?.length > 0

  return (
    <div
      className={`model-row prod-tile--${category?.color || 'gray'}`}
      onClick={onOpen}
      onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY, model) }}
    >
      <div className={`prod-row-thumb${hasImage ? ' prod-row-thumb--photo' : ''}`}>
        {hasImage
          ? <img src={productImageUrl(model.images[0])} alt="" />
          : <span className="prod-noimg"><PackageOpen size={18} strokeWidth={1.5} /></span>}
      </div>

      <div className="model-row-main">
        <div className="model-row-name" title={model.name}>{model.name}</div>
        <div className="prod-row-sub">
          {model.brand && <span className="prod-row-brand">{model.brand}</span>}
          {model.reference && <span>Réf. {model.reference}</span>}
        </div>
      </div>

      <div className="model-row-figures">
        {[
          { key: 'total',       label: 'Total',       value: s.total       ?? 0, tone: 'slate' },
          { key: 'disponible',  label: 'Disponible',  value: s.disponible  ?? 0, tone: 'mint'  },
          { key: 'reserve',     label: 'Réservé',     value: s.reserve     ?? 0, tone: 'sky'   },
          { key: 'maintenance', label: 'Maintenance', value: s.maintenance ?? 0, tone: 'sun'   },
          ...(category?.tracksLot
            ? [{ key: 'expired', label: 'DLC dépassée', value: s.expired ?? 0, tone: 'ember' }]
            : []),
        ].map(f => (
          <div key={f.key} className={`model-figure model-figure--${f.tone}${f.value === 0 ? ' model-figure--zero' : ''}`}>
            <span className="model-figure-value">{f.value}</span>
            <span className="model-figure-label">{f.label}</span>
          </div>
        ))}
      </div>

      <ChevronRight size={16} className="model-row-go" />
    </div>
  )
}
/* ─── Tuile produit ─── */
function ProductTile({ product: p, category, onOpen, onMenu }) {
  const status = getStockStatus(p.stock, p.alertThreshold)
  const exp    = category?.tracksLot ? getExpirationStatus(p.expirationDate) : null
  const ratio  = p.alertThreshold > 0
    ? Math.min((p.stock / (p.alertThreshold * 2)) * 100, 100)
    : (p.stock > 0 ? 100 : 0)
  const hasImage = p.images?.length > 0

  return (
    <div
      className={`prod-tile prod-tile--${category?.color || 'gray'}`}
      onClick={onOpen}
      onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY, p) }}
    >
      {/* Sans photo : un repli neutre « produit sans visuel », identique pour
          toutes les catégories — pas de filigrane coloré. */}
      <div className={`prod-tile-media${hasImage ? ' prod-tile-media--photo' : ' prod-tile-media--empty'}`}>
        {hasImage
          ? <img src={productImageUrl(p.images[0])} alt="" />
          : <span className="prod-noimg"><PackageOpen size={26} strokeWidth={1.5} /></span>}

        <span className={`prod-tile-stockbadge prod-tile-stockbadge--${status}`}>
          <i className="prod-tile-dot" />
          {status === 'out' ? 'Épuisé' : status === 'low' ? 'Stock faible' : 'En stock'}
        </span>

        {/* Les actions vivent dans le menu contextuel — ce bouton l'ouvre aussi
            au clic gauche, pour rester atteignable au clavier et au tactile. */}
        <button
          type="button"
          className="prod-tile-more"
          title="Actions"
          onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu(r.right, r.bottom + 4, p) }}
        >
          <MoreVertical size={15} />
        </button>
      </div>

      <div className="prod-tile-body">
        <div className="prod-tile-head">
          {p.brand && <span className="prod-tile-brand">{p.brand}</span>}
          {exp && (
            <span className={`prod-tile-exp prod-tile-exp--${exp.level}`}>
              {exp.level === 'expired' ? 'Expiré' : exp.level === 'ok' ? formatDate(p.expirationDate) : `${exp.days} j`}
            </span>
          )}
        </div>

        <div className="prod-tile-name" title={p.name}>{p.name}</div>

        <div className="prod-tile-foot">
          <div className="prod-tile-stock">
            <span className={`prod-tile-qty prod-tile-qty--${status}`}>{p.stock}</span>
            <span className="prod-tile-min">/ min {p.alertThreshold}</span>
          </div>
          <div className="prod-tile-bar">
            <span className={`prod-tile-bar-fill prod-tile-bar-fill--${status}`} style={{ width: `${ratio}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Menu contextuel produit ─── */
function ProductMenu({ menu, onClose, actions }) {
  useEffect(() => {
    function close() { onClose() }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // On garde le menu dans la fenêtre quel que soit l'endroit du clic.
  const width  = 210
  const height = 44 + actions.length * 34
  const left = Math.min(menu.x, window.innerWidth  - width  - 10)
  const top  = Math.min(menu.y, window.innerHeight - height - 10)

  return (
    <div className="ctx-menu" style={{ left, top }} onClick={e => e.stopPropagation()}>
      <div className="ctx-menu-head">{menu.product.name}</div>
      {actions.map(a => {
        const Icon = a.icon
        return (
          <button
            key={a.label}
            type="button"
            className={`ctx-menu-item${a.danger ? ' ctx-menu-item--danger' : ''}`}
            onClick={() => { onClose(); a.onClick(menu.product) }}
          >
            <Icon size={14} /> {a.label}
          </button>
        )
      })}
    </div>
  )
}


/* ─── Page principale ─── */
const LIMIT = 500

const STOCK_STATES = [
  { value: '',    label: 'Tout le stock' },
  { value: 'ok',  label: 'En stock' },
  { value: 'low', label: 'Stock faible' },
  { value: 'out', label: 'Épuisé' },
]

const EXPIRY_FILTERS = [
  { value: '',        label: 'Toutes péremptions' },
  { value: 'expired', label: 'Expirés' },
  { value: '30',      label: 'Expire sous 30 j' },
  { value: '60',      label: 'Expire sous 60 j' },
  { value: '90',      label: 'Expire sous 90 j' },
]

export default function StockPage() {
  const navigate = useNavigate()

  // La vue courante vit dans l'URL (?tab=…&cat=…) pour que la navigation
  // arrière du navigateur revienne à la catégorie ou à l'onglet précédent.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab      = searchParams.get('tab')  || 'categories'
  const catSlug  = searchParams.get('cat')  || ''
  // Le dashboard pointe ici avec un type déjà choisi (batteries / électrodes).
  const parcType = searchParams.get('type') || ''

  const [categories, setCategories] = useState([])
  const [menu,       setMenu]       = useState(null)   // { x, y, product }

  // Grille ou liste : préférence d'affichage retenue d'une visite à l'autre.
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('stockViewMode') || 'grid')
  function changeViewMode(mode) {
    setViewMode(mode)
    localStorage.setItem('stockViewMode', mode)
  }

  const [products, setProducts] = useState([])
  // Les catégories à suivi unitaire s'ouvrent sur leurs modèles, chacun avec
  // ses compteurs d'articles — pas sur la grille de produits.
  const [models,   setModels]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  // Filtres de la vue catégorie
  const [search,         setSearch]         = useState('')
  const [brandFilter,    setBrandFilter]    = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [stockState,     setStockState]     = useState('')
  const [expiryFilter,   setExpiryFilter]   = useState('')

  const [modal,      setModal]      = useState(null)
  const [adjusting,  setAdjusting]  = useState(null)
  const [archiving,  setArchiving]  = useState(null)
  const [destroying, setDestroying] = useState(null)
  const [viewingMovements,      setViewingMovements]      = useState(null)
  const [viewingMovementDetail, setViewingMovementDetail] = useState(null)

  const [allMovements, setAllMovements] = useState([])
  const [mvTotal,      setMvTotal]      = useState(0)
  const [mvPage,       setMvPage]       = useState(1)
  const [mvLoading,    setMvLoading]    = useState(false)

  useLoadingBar(loading)

  const isMovements  = tab === 'movements'
  const isArchived   = tab === 'archived'
  const isParc       = tab === 'parc'
  const mvTotalPages = Math.ceil(mvTotal / 50)

  const catBySlug = useMemo(
    () => Object.fromEntries(categories.map(c => [c.slug, c])),
    [categories]
  )
  const activeCat = catSlug ? catBySlug[catSlug] || null : null

  const fetchCategories = useCallback(async () => {
    try {
      const data = await getProductCategories({ withStats: 'true' })
      setCategories(Array.isArray(data) ? data : [])
    } catch (err) { toast.error(formatApiError(err)) }
  }, [])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  /* Rien n'est chargé tant qu'on est sur l'accueil : les cartes de catégories
     se contentent des compteurs agrégés.

     Dans une catégorie, une seule requête sert les deux affichages — chaque
     produit arrive avec le décompte de ses articles, que les cartes ignorent et
     que la liste met en avant. Les archives restent sur l'ancien endpoint :
     elles n'ont pas d'articles à compter. */
  const fetchProducts = useCallback(async () => {
    if (catSlug && !activeCat) return           // catégories pas encore chargées
    if (!activeCat && !isArchived) { setProducts([]); setModels([]); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      if (isArchived) {
        const res = await getProducts({ limit: LIMIT, archived: 'true' })
        setProducts(Array.isArray(res.data) ? res.data : [])
        setModels([])
        return
      }
      const rows = await getStockModels({ category: activeCat.slug })
      setModels(Array.isArray(rows) ? rows : [])
      setProducts([])
    } catch (err) {
      const msg = formatApiError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [activeCat, catSlug, isArchived])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const fetchAllMovements = useCallback(async () => {
    setMvLoading(true)
    try {
      const res = await getAllMovements({ page: mvPage, limit: 50 })
      setAllMovements(Array.isArray(res) ? res : (res.data || []))
      setMvTotal(res.total || 0)
    } catch { setAllMovements([]) } finally { setMvLoading(false) }
  }, [mvPage])

  useEffect(() => { if (isMovements) fetchAllMovements() }, [isMovements, fetchAllMovements])

  /* Marques et fournisseurs proposés : ceux réellement présents dans la vue. */
  const brands    = useMemo(() => [...new Set(models.map(p => p.brand).filter(Boolean))].sort(), [models])
  const suppliers = useMemo(() => [...new Set(models.map(p => p.supplier).filter(Boolean))].sort(), [models])

  const visibleModels = useMemo(() => {
    const q = search.trim().toLowerCase()
    return models.filter(m => {
      if (q && ![m.name, m.reference, m.brand, m.supplier].some(v => v?.toLowerCase().includes(q))) return false
      if (brandFilter    && m.brand    !== brandFilter)    return false
      if (supplierFilter && m.supplier !== supplierFilter) return false
      // Un modèle est « épuisé » quand plus aucun exemplaire n'est disponible.
      if (stockState) {
        const s = m.summary || {}
        const state = s.disponible === 0 ? 'out'
          : s.disponible <= (m.alertThreshold || 0) ? 'low' : 'ok'
        if (state !== stockState) return false
      }
      if (expiryFilter) {
        const s = m.summary || {}
        if (expiryFilter === 'expired') return (s.expired ?? 0) > 0
        return (s.expiringSoon ?? 0) > 0
      }
      return true
    })
  }, [models, search, brandFilter, supplierFilter, stockState, expiryFilter])

  function resetFilters() {
    setSearch(''); setBrandFilter(''); setSupplierFilter('')
    setStockState(''); setExpiryFilter('')
  }

  // Chaque changement de vue empile une entrée d'historique.
  function openCategory(cat) {
    setSearchParams({ tab: 'categories', cat: cat.slug })
  }

  function backToCategories() {
    setSearchParams({ tab: 'categories' })
  }

  function switchTab(next) {
    setSearchParams({ tab: next })
  }

  // Les filtres sont propres à une vue : ils repartent à zéro quand elle change.
  useEffect(() => { resetFilters() }, [tab, catSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Chaque catégorie ouvre sur son affichage par défaut : la liste à compteurs
     pour celles réglées en « vue par modèles », les cartes sinon. Le bouton de
     bascule reste maître pour la visite en cours. */
  useEffect(() => {
    if (!activeCat) return
    setViewMode(activeCat.tracksItems ? 'list' : (localStorage.getItem('stockViewMode') || 'grid'))
  }, [activeCat])

  async function handleRestore(product) {
    try {
      await restoreProduct(product._id)
      toast.success(`${product.name} restauré.`)
      fetchProducts(); fetchCategories()
    } catch (err) { toast.error(formatApiError(err)) }
  }

  function refresh() { fetchProducts(); fetchCategories() }
  function handleSaved()     { setModal(null);      refresh() }
  function handleAdjusted()  { setAdjusting(null);  refresh() }
  function handleArchived()  { setArchiving(null);  refresh() }
  function handleDestroyed() { setDestroying(null); refresh() }

  /* Indicateurs de la catégorie ouverte. Ils viennent des articles, seuls à
     connaître réservations, maintenance et DLC — la péremption n'apparaît que
     pour les catégories suivies par lot. */
  const catStats = useMemo(() => {
    if (!activeCat) return []

    const agg = models.reduce((a, m) => {
      const s = m.summary || {}
      a.total       += s.total       || 0
      a.disponible  += s.disponible  || 0
      a.reserve     += s.reserve     || 0
      a.maintenance += s.maintenance || 0
      a.expired     += s.expired     || 0
      return a
    }, { total: 0, disponible: 0, reserve: 0, maintenance: 0, expired: 0 })

    const cards = [
      { key: 'models', tone: 'slate', icon: Layers,           label: 'Références',     value: models.length },
      { key: 'total',  tone: 'slate', icon: Boxes,            label: 'Stock actuel',   value: agg.total },
      { key: 'dispo',  tone: 'mint',  icon: PackageOpen,      label: 'Disponibles',    value: agg.disponible },
      { key: 'resa',   tone: 'sky',   icon: Clock,            label: 'Réservés',       value: agg.reserve },
      // Les compteurs d'alerte ne se colorent que s'ils ont quelque chose à dire.
      { key: 'maint',  tone: 'sun',   icon: SlidersHorizontal, label: 'En maintenance', alert: true, value: agg.maintenance },
    ]
    if (activeCat.tracksLot) {
      cards.push({ key: 'expired', tone: 'ember', icon: AlertTriangle, label: 'DLC dépassée', alert: true, value: agg.expired })
    }
    return cards
  }, [activeCat, models])

  return (
    <div className="page-content">

      {/* ── En-tête ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {activeCat && (
              <button className="back-btn" onClick={backToCategories}><ArrowLeft size={16} /></button>
            )}
            {activeCat ? activeCat.name : 'Stock & Produits'}
          </h1>
          <p className="page-subtitle">
            {isParc
              ? 'Batteries et électrodes posées chez les clients, par échéance'
              : isMovements
              ? `${mvTotal} mouvement${mvTotal !== 1 ? 's' : ''} enregistré${mvTotal !== 1 ? 's' : ''}`
              : isArchived
                ? `${products.length} produit${products.length !== 1 ? 's' : ''} archivé${products.length !== 1 ? 's' : ''}`
                : activeCat
                  ? `${visibleModels.length} référence${visibleModels.length !== 1 ? 's' : ''} affichée${visibleModels.length !== 1 ? 's' : ''}`
                  : `${categories.length} catégorie${categories.length !== 1 ? 's' : ''} de produits`
            }
          </p>
        </div>
        {!isMovements && !isArchived && !isParc && (
          <div className="page-header-actions">
            {/* Reprendre un catalogue existant ligne à ligne serait interminable :
                l'aller-retour Excel évite la saisie manuelle des modèles. */}
            <button className="btn btn--ghost" onClick={() => navigate('/stock/import')}>
              <FileSpreadsheet size={15} /> Import / export Excel
            </button>
            <button className="btn btn--primary" onClick={() => setModal('create')}>
              <Plus size={15} /> Nouveau produit
            </button>
          </div>
        )}
      </div>

      {/* ── Onglets ── */}
      {!activeCat && (
        <div className="stock-tabs">
          {[
            { value: 'categories', label: 'Catégories' },
            { value: 'parc',       label: 'Échéances parc' },
            { value: 'movements',  label: 'Mouvements de stocks' },
            { value: 'archived',   label: 'Archivés' },
          ].map(t => (
            <button
              key={t.value}
              className={`stock-tab${tab === t.value ? ' stock-tab--active' : ''}`}
              onClick={() => switchTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Accueil : cartes de catégories ── */}
      {tab === 'categories' && !activeCat && (
        <CategoryGrid categories={categories} onPick={openCategory} />
      )}

      {/* ── Échéances du parc ── */}
      {isParc && <ParcExpiryTab initialType={parcType} />}

      {/* ── Vue catégorie ── */}
      {activeCat && (
        <>
          <div className="cat-stats-row">
            {catStats.map(c => {
              const StatIcon = c.icon
              return (
                <div key={c.key}
                  className={`cat-stat cat-stat--${c.tone}${c.alert && c.value > 0 ? ' cat-stat--alert' : ''}`}>
                  <span className="cat-stat-icon"><StatIcon size={15} strokeWidth={2.2} /></span>
                  <span className="cat-stat-value">{c.value}</span>
                  <span className="cat-stat-label">{c.label}</span>
                </div>
              )
            })}
          </div>

          <div className="table-toolbar cat-filters">
            <div className="search-wrap">
              <Search size={14} className="search-icon" />
              <input className="search-input" placeholder="Rechercher dans la catégorie…"
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>}
            </div>

            <select className="cat-filter-select" value={activeCat.slug}
              onChange={e => openCategory(catBySlug[e.target.value])}>
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>

            {brands.length > 0 && (
              <select className="cat-filter-select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                <option value="">Toutes marques</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}

            {suppliers.length > 0 && (
              <select className="cat-filter-select" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                <option value="">Tous fournisseurs</option>
                {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            <select className="cat-filter-select" value={stockState} onChange={e => setStockState(e.target.value)}>
              {STOCK_STATES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>

            {activeCat.tracksLot && (
              <select className="cat-filter-select" value={expiryFilter} onChange={e => setExpiryFilter(e.target.value)}>
                {EXPIRY_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            )}

            <div className="view-toggle">
              {[
                { mode: 'grid', icon: LayoutGrid, label: 'Vue cartes' },
                { mode: 'list', icon: List,       label: 'Vue liste — total, disponible, réservé…' },
              ].map(({ mode, icon: ModeIcon, label }) => (
                <button
                  key={mode}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={viewMode === mode}
                  className={`view-toggle-btn${viewMode === mode ? ' view-toggle-btn--active' : ''}`}
                  onClick={() => changeViewMode(mode)}
                >
                  <ModeIcon size={15} />
                </button>
              ))}
            </div>
          </div>

          {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

          {loading ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : visibleModels.length === 0 ? (
            <div className="table-empty">
              <Package size={36} color="var(--gray-300)" />
              <p>{models.length === 0 ? 'Aucun produit dans cette catégorie.' : 'Aucun résultat pour ces filtres.'}</p>
              {models.length === 0 && (
                <button className="btn btn--primary" onClick={() => setModal('create')}>
                  <Plus size={14} /> Ajouter un produit
                </button>
              )}
            </div>
          ) : viewMode === 'list' ? (
            /* Liste : chaque référence avec le décompte de ses articles. */
            <div className="model-list">
              {visibleModels.map(m => (
                <ModelRow
                  key={m._id}
                  model={m}
                  category={activeCat}
                  onOpen={() => navigate(`/stock/${m._id}`)}
                  onMenu={(x, y, prod) => setMenu({ x, y, product: prod })}
                />
              ))}
            </div>
          ) : (
            <div className="prod-grid">
              {visibleModels.map(p => (
                <ProductTile
                  key={p._id}
                  product={p}
                  category={activeCat}
                  onOpen={() => navigate(`/stock/${p._id}`)}
                  onMenu={(x, y, prod) => setMenu({ x, y, product: prod })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Archivés ── */}
      {isArchived && (
        loading ? (
          <div className="table-loading"><span className="spinner" /></div>
        ) : products.length === 0 ? (
          <div className="table-empty">
            <Archive size={36} color="var(--gray-300)" />
            <p>Aucun produit archivé.</p>
          </div>
        ) : (
          <div className="prod-grid">
            {products.map(p => (
              <div key={p._id} className="prod-tile prod-tile--archived prod-tile--gray">
                <div className={`prod-tile-media${p.images?.length > 0 ? ' prod-tile-media--photo' : ' prod-tile-media--empty'}`}>
                  {p.images?.length > 0
                    ? <img src={productImageUrl(p.images[0])} alt="" />
                    : <span className="prod-noimg"><PackageOpen size={26} strokeWidth={1.5} /></span>}
                </div>
                <div className="prod-tile-body">
                  <div className="prod-tile-head">
                    {catBySlug[p.category] && <span className="prod-tile-brand">{catBySlug[p.category].name}</span>}
                  </div>
                  <div className="prod-tile-name">{p.name}</div>
                  {p.reference && <div className="prod-tile-ref">Réf. {p.reference}</div>}
                </div>
                <div className="prod-tile-actions">
                  <button className="action-btn action-btn--restore" title="Restaurer" onClick={() => handleRestore(p)}>
                    <RotateCcw size={14} />
                  </button>
                  <button className="action-btn action-btn--destroy" title="Supprimer définitivement" onClick={() => setDestroying(p)}>
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Mouvements ── */}
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
                  const isSerial  = mv.type === 'serialisation'
                  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
                  const sign      = isEntree ? '+' : isSortie ? '-' : isSerial ? '' : '→'
                  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : isSerial ? Hash : SlidersHorizontal
                  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : isSerial ? 'Saisie de séries' : 'Correction'
                  const prod      = mv.product
                  const cat       = prod?.category ? catBySlug[prod.category] : null
                  return (
                    <tr key={mv._id} className="mv-row--clickable" onClick={() => setViewingMovementDetail(mv)}>
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
                        {cat
                          ? <span className={`cat-badge cat--${cat.color}`}>{cat.name}</span>
                          : <span className="cell-muted">—</span>}
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
                          : <span className="cell-muted">—</span>}
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
          defaultCategory={modal === 'create' ? activeCat?.slug : undefined}
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
      {menu && (
        <ProductMenu
          menu={menu}
          onClose={() => setMenu(null)}
          actions={[
            { label: 'Voir la fiche',    icon: Eye,               onClick: pr => navigate(`/stock/${pr._id}`) },
            { label: 'Mouvements',       icon: History,           onClick: pr => setViewingMovements(pr) },
            { label: 'Ajuster le stock', icon: SlidersHorizontal, onClick: pr => setAdjusting(pr) },
            { label: 'Modifier',         icon: Pencil,            onClick: pr => setModal(pr) },
            { label: 'Archiver',         icon: Trash2,            onClick: pr => setArchiving(pr), danger: true },
          ]}
        />
      )}
    </div>
  )
}
