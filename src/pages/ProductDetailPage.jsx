import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Pencil, SlidersHorizontal, X, AlertTriangle, Package,
  TrendingUp, TrendingDown, History, User, ImagePlus,
  Hash, Layers, Search, Boxes, Camera,
} from 'lucide-react'
import {
  getProduct, getMovements, adjustStock,
  uploadProductImage, deleteProductImage, productImageUrl,
} from '../api/products'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ProductModal from '../components/ProductModal'
import ProductItemsTab from '../components/ProductItemsTab'
import { getProductCategories } from '../api/productCategories'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
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
  if (val == null || val === '') return null
  return `${Number(val).toLocaleString('fr-FR')} DT`
}

/* ─── Ligne de mouvement ─── */
function MovementRow({ mv, onClick }) {
  const isEntree  = mv.type === 'entree'
  const isSortie  = mv.type === 'sortie'
  const isSerial  = mv.type === 'serialisation'
  const cls       = isEntree ? 'entree' : isSortie ? 'sortie' : 'ajust'
  const TypeIcon  = isEntree ? TrendingUp : isSortie ? TrendingDown : isSerial ? Hash : SlidersHorizontal
  const typeLabel = isEntree ? 'Entrée' : isSortie ? 'Sortie' : isSerial ? 'Saisie de séries' : 'Correction'
  const sign      = isEntree ? '+' : isSortie ? '-' : isSerial ? '' : '→'
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
          {!isSerial && mv.previousStock != null && mv.newStock != null && (
            <span className="mv-stocks">{mv.previousStock} → {mv.newStock}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Détail d'un mouvement ─── */
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
                {!isSerial && movement.previousStock != null && movement.newStock != null && (
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
/* ─── Photo du produit ─────────────────────────────────────
   Une seule photo, posée à côté du nom : cliquer l'ajoute ou la remplace, la
   croix la retire. Le modèle en accepte plusieurs, on n'expose que la première
   — c'est tout ce dont la fiche a besoin. */
function ProductPhoto({ product, onChanged }) {
  const [busy, setBusy] = useState(false)
  const photo = product.images?.[0]

  async function handlePick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBusy(true)
    try {
      // Remplacer, pas empiler : les anciennes partent d'abord.
      for (const old of product.images || []) await deleteProductImage(product._id, old)
      onChanged(await uploadProductImage(product._id, file))
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(e) {
    e.preventDefault(); e.stopPropagation()
    setBusy(true)
    try {
      onChanged(await deleteProductImage(product._id, photo))
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className={`pd-photo${photo ? ' pd-photo--filled' : ''}`} title={photo ? 'Changer la photo' : 'Ajouter une photo'}>
      {busy
        ? <span className="spinner" />
        : photo
          ? <img src={productImageUrl(photo)} alt={product.name} />
          : <ImagePlus size={20} strokeWidth={1.6} />}

      {!busy && photo && (
        <>
          <span className="pd-photo-hover"><Camera size={16} /></span>
          <button type="button" className="pd-photo-del" title="Retirer la photo" onClick={handleRemove}>
            <X size={11} />
          </button>
        </>
      )}
      <input type="file" accept="image/*" hidden onChange={handlePick} disabled={busy} />
    </label>
  )
}

/* ─── Page principale ─────────────────────────────────────
   Deux vues seulement : le parc du produit article par article, et le journal
   de ses mouvements. Tout ce qui décrit le produit lui-même s'édite dans la
   modale « Modifier ». */
const TABS = [
  { key: 'articles',   label: 'Articles',   icon: Boxes   },
  { key: 'mouvements', label: 'Mouvements', icon: History },
]

export default function ProductDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [product,    setProduct]    = useState(null)
  const [categories, setCategories] = useState([])
  const [movements,  setMovements]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [mvLoading,  setMvLoading]  = useState(true)
  const [editOpen,   setEditOpen]   = useState(false)
  const [adjOpen,    setAdjOpen]    = useState(false)
  const [activeTab,  setActiveTab]  = useState('articles')
  const [mvDetail,   setMvDetail]   = useState(null)

  useLoadingBar(loading)

  const loadProduct = useCallback(async () => {
    try {
      setProduct(await getProduct(id))
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
    getProductCategories().then(d => setCategories(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  /* Toute écriture sur les articles crée un mouvement : les deux vues se
     rafraîchissent ensemble, sinon le journal reste bloqué sur son état
     d'ouverture de page. */
  const refresh = useCallback(() => { loadProduct(); loadMovements() }, [loadProduct, loadMovements])

  if (loading || !product) {
    return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  }

  const category = categories.find(c => c.slug === product.category) || null

  const meta = [
    product.reference && `Réf. ${product.reference}`,
    product.brand,
    product.supplier,
    formatPrice(product.salePrice) && `Vente ${formatPrice(product.salePrice)}`,
    formatPrice(product.purchasePrice) && `Achat ${formatPrice(product.purchasePrice)}`,
    product.alertThreshold != null && `Seuil ${product.alertThreshold}`,
  ].filter(Boolean)

  return (
    <div className="page-content">
      {/* ── En-tête ── */}
      <div className="page-header">
        <div className="pd-head">
          {/* Retour vers la catégorie d'où l'on vient, pas vers l'accueil du stock. */}
          <button
            className="back-btn"
            title={category ? `Retour à ${category.name}` : 'Retour au stock'}
            onClick={() => navigate(`/stock?tab=categories&cat=${encodeURIComponent(product.category)}`)}
          >
            <ArrowLeft size={16} />
          </button>
          <ProductPhoto product={product} onChanged={setProduct} />
          <div>
            <h1 className="page-title">{product.name}</h1>
            <div className="pd-header-meta">
              {category
                ? <span className={`cat-badge cat--${category.color}`}>{category.name}</span>
                : <span className="type-badge">{product.category}</span>}
              {meta.map(m => <span key={m} className="cell-secondary">{m}</span>)}
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

      {/* ── Onglets ── */}
      <div className="pd-tabs">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              className={`pd-tab${activeTab === t.key ? ' pd-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <Icon size={14} /> {t.label}
              {t.key === 'mouvements' && !mvLoading && movements.length > 0 && (
                <span className="pd-count">{movements.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {activeTab === 'articles' && (
        <ProductItemsTab product={product} category={category} onStockChanged={refresh} />
      )}

      {activeTab === 'mouvements' && (
        <div className="pd-section">
          <div className="pd-section-title">
            <History size={14} /> Mouvements de stock
            {!mvLoading && <span className="pd-count">{movements.length}</span>}
            <button className="btn btn--ghost btn--sm pd-section-action" onClick={() => setAdjOpen(true)}>
              <SlidersHorizontal size={13} /> Ajuster
            </button>
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
                <MovementRow key={mv._id} mv={mv} onClick={() => setMvDetail(mv)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modales ── */}
      {editOpen && (
        <ProductModal
          product={product}
          onClose={() => setEditOpen(false)}
          onSaved={updated => { setEditOpen(false); updated ? setProduct(updated) : loadProduct() }}
        />
      )}
      {adjOpen && (
        <StockAdjustModal
          product={product}
          onClose={() => setAdjOpen(false)}
          onDone={() => { setAdjOpen(false); refresh() }}
        />
      )}
      {mvDetail && (
        <MovementDetailModal movement={mvDetail} onClose={() => setMvDetail(null)} />
      )}
    </div>
  )
}
