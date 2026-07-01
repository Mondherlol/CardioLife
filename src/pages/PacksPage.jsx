import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'react-toastify'
import {
  Plus, Search, Pencil, Trash2, X, AlertTriangle, Package, Boxes,
  ChevronLeft, ChevronRight, RotateCcw, Trash, Archive,
  Minus, GraduationCap, Tag, Sparkles,
} from 'lucide-react'
import {
  getPacks, createPack, updatePack,
  archivePack, restorePack, destroyPack, computeTheoreticalPrice,
} from '../api/packs'
import { getProducts, productImageUrl } from '../api/products'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ComboSearch from '../components/ComboSearch'

const LIMIT = 24

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

function formatPrice(val) {
  if (val == null || val === '' || Number.isNaN(Number(val))) return '—'
  return `${Number(val).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} DT`
}

/* ─────────────────────────────────────────────
   Encart prix : théorique (barré) vs réel + économie
   ───────────────────────────────────────────── */
function PriceCompare({ theoretical, real, size = 'md' }) {
  const hasReal   = real != null && real !== '' && !Number.isNaN(Number(real))
  const realNum   = Number(real)
  const diff      = hasReal ? theoretical - realNum : 0
  const pct       = hasReal && theoretical > 0 ? Math.round((diff / theoretical) * 100) : 0
  const isSaving  = hasReal && diff > 0.001

  return (
    <div className={`pack-price pack-price--${size}`}>
      <div className="pack-price-row">
        <span className="pack-price-theo-label">Prix théorique</span>
        <span className={`pack-price-theo${isSaving ? ' pack-price-theo--struck' : ''}`}>
          {formatPrice(theoretical)}
        </span>
      </div>
      <div className="pack-price-row">
        <span className="pack-price-real-label">Prix du pack</span>
        <span className="pack-price-real">{hasReal ? formatPrice(realNum) : '—'}</span>
      </div>
      {isSaving && (
        <div className="pack-savings">
          <Sparkles size={12} /> Économie {formatPrice(diff)} · −{pct}%
        </div>
      )}
      {hasReal && diff < -0.001 && (
        <div className="pack-savings pack-savings--over">
          <AlertTriangle size={12} /> Prix supérieur de {formatPrice(-diff)}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Carte pack (liste)
   ───────────────────────────────────────────── */
function PackCard({ pack, onEdit, onArchive, onRestore, onDestroy, archived }) {
  const theoretical = computeTheoreticalPrice(pack)
  const productCount = (pack.products || []).reduce((s, p) => s + (Number(p.quantity) || 1), 0)
  const serviceCount = (pack.services || []).length

  return (
    <div className={`pack-card${archived ? ' pack-card--archived' : ''}`}>
      <div className="pack-card-head">
        <div className="pack-card-icon"><Boxes size={18} /></div>
        <div className="pack-card-titles">
          <h3 className="pack-card-name">{pack.name}</h3>
          {pack.description && <p className="pack-card-desc">{pack.description}</p>}
        </div>
      </div>

      <div className="pack-card-meta">
        <span className="pack-chip"><Package size={12} /> {productCount} produit{productCount !== 1 ? 's' : ''}</span>
        {serviceCount > 0 && (
          <span className="pack-chip pack-chip--service"><GraduationCap size={12} /> {serviceCount} service{serviceCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Aperçu contenu */}
      <div className="pack-card-items">
        {(pack.products || []).slice(0, 4).map((item, i) => (
          <div key={i} className="pack-item-line">
            {item.product?.images?.length
              ? <img src={productImageUrl(item.product.images[0])} alt="" className="pack-item-thumb" />
              : <div className="pack-item-thumb pack-item-thumb--empty"><Package size={11} /></div>}
            <span className="pack-item-name">{item.product?.name || 'Produit supprimé'}</span>
            <span className="pack-item-qty">×{item.quantity || 1}</span>
          </div>
        ))}
        {(pack.products || []).length > 4 && (
          <div className="pack-item-more">+{pack.products.length - 4} autre(s) produit(s)</div>
        )}
        {(pack.services || []).slice(0, 3).map((s, i) => (
          <div key={`s-${i}`} className="pack-item-line pack-item-line--service">
            <div className="pack-item-thumb pack-item-thumb--service"><GraduationCap size={11} /></div>
            <span className="pack-item-name">{s.name}</span>
            <span className="pack-item-qty">{formatPrice(s.price)}</span>
          </div>
        ))}
      </div>

      <PriceCompare theoretical={theoretical} real={pack.realPrice} size="md" />

      <div className="pack-card-actions">
        {archived ? (
          <>
            <button className="btn btn--ghost" onClick={() => onRestore(pack)}>
              <RotateCcw size={14} /> Restaurer
            </button>
            <button className="action-btn action-btn--destroy" title="Supprimer définitivement" onClick={() => onDestroy(pack)}>
              <Trash size={14} />
            </button>
          </>
        ) : (
          <>
            <button className="btn btn--ghost" onClick={() => onEdit(pack)}>
              <Pencil size={14} /> Modifier
            </button>
            <button className="action-btn action-btn--delete" title="Archiver" onClick={() => onArchive(pack)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Modal création / édition
   ───────────────────────────────────────────── */
function PackModal({ pack, products, onClose, onSaved }) {
  const [name,        setName]        = useState(pack?.name || '')
  const [description, setDescription] = useState(pack?.description || '')
  const [items,       setItems]       = useState(
    (pack?.products || []).map(p => ({
      product:  p.product,               // objet peuplé
      quantity: p.quantity || 1,
    }))
  )
  const [services,    setServices]    = useState(
    (pack?.services || []).map(s => ({ name: s.name, price: s.price ?? '' }))
  )
  const [realPrice,   setRealPrice]   = useState(pack?.realPrice ?? '')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  const isEdit = !!pack?._id

  const selectedIds = new Set(items.map(i => i.product?._id))
  const availableProducts = products.filter(p => !selectedIds.has(p._id))

  function addProduct(product) {
    setItems(prev => [...prev, { product, quantity: 1 }])
  }
  function setQty(productId, qty) {
    setItems(prev => prev.map(i =>
      i.product?._id === productId ? { ...i, quantity: Math.max(1, qty) } : i
    ))
  }
  function removeProduct(productId) {
    setItems(prev => prev.filter(i => i.product?._id !== productId))
  }

  function addService() {
    setServices(prev => [...prev, { name: '', price: '' }])
  }
  function setService(idx, field, value) {
    setServices(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }
  function removeService(idx) {
    setServices(prev => prev.filter((_, i) => i !== idx))
  }

  // Prix théorique en direct
  const theoretical = useMemo(() => computeTheoreticalPrice({
    products: items,
    services: services.map(s => ({ price: Number(s.price) || 0 })),
  }), [items, services])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Le nom du pack est requis.'); return }
    if (services.some(s => !s.name.trim())) {
      setError('Chaque service doit avoir un nom (ou supprimez la ligne vide).'); return
    }
    setError('')
    setLoading(true)
    try {
      const payload = {
        name:        name.trim(),
        description: description.trim(),
        products:    items.map(i => ({ product: i.product._id, quantity: i.quantity })),
        services:    services
          .filter(s => s.name.trim())
          .map(s => ({ name: s.name.trim(), price: Number(s.price) || 0 })),
        realPrice:   realPrice === '' ? '' : Number(realPrice),
      }
      if (isEdit) await updatePack(pack._id, payload)
      else        await createPack(payload)
      toast.success(isEdit ? 'Pack mis à jour.' : 'Pack créé.')
      onSaved()
    } catch (err) {
      setError(formatApiError(err))
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--lg">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{isEdit ? 'Modifier le pack' : 'Nouveau pack'}</h2>
            <div className="modal-subtitle">Regroupez des produits et services en une offre</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Infos générales */}
          <div className="form-group">
            <label className="form-label">Nom du pack <span style={{ color: 'var(--red-500)' }}>*</span></label>
            <input
              className="form-input form-input--plain"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ex. Pack Défibrillateur + Formation"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description <span className="form-label-opt">(optionnel)</span></label>
            <textarea
              className="form-input form-input--plain form-textarea"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Courte description de l'offre…"
            />
          </div>

          {/* ── Produits ── */}
          <div className="pack-section">
            <div className="pack-section-title"><Package size={15} /> Produits</div>
            <ComboSearch
              items={availableProducts}
              value={null}
              onChange={addProduct}
              onClear={() => {}}
              displayFn={p => p.name}
              subtextFn={p => [p.reference && `Réf. ${p.reference}`, p.salePrice != null && `${formatPrice(p.salePrice)}`].filter(Boolean).join(' · ')}
              placeholder="Rechercher un produit à ajouter…"
              emptyText="Aucun produit"
            />

            {items.length > 0 && (
              <div className="pack-builder-list">
                {items.map(item => (
                  <div key={item.product._id} className="pack-builder-row">
                    {item.product.images?.length
                      ? <img src={productImageUrl(item.product.images[0])} alt="" className="pack-item-thumb" />
                      : <div className="pack-item-thumb pack-item-thumb--empty"><Package size={12} /></div>}
                    <div className="pack-builder-info">
                      <div className="pack-builder-name">{item.product.name}</div>
                      <div className="pack-builder-sub">{formatPrice(item.product.salePrice)} / unité</div>
                    </div>
                    <div className="pack-qty-stepper">
                      <button type="button" onClick={() => setQty(item.product._id, item.quantity - 1)} disabled={item.quantity <= 1}>
                        <Minus size={13} />
                      </button>
                      <input
                        type="number" min="1"
                        value={item.quantity}
                        onChange={e => setQty(item.product._id, Number(e.target.value) || 1)}
                      />
                      <button type="button" onClick={() => setQty(item.product._id, item.quantity + 1)}>
                        <Plus size={13} />
                      </button>
                    </div>
                    <div className="pack-builder-linetotal">
                      {formatPrice((Number(item.product.salePrice) || 0) * item.quantity)}
                    </div>
                    <button type="button" className="pack-row-remove" onClick={() => removeProduct(item.product._id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Services ── */}
          <div className="pack-section">
            <div className="pack-section-title"><GraduationCap size={15} /> Services</div>
            {services.length > 0 && (
              <div className="pack-builder-list">
                {services.map((s, idx) => (
                  <div key={idx} className="pack-service-row">
                    <input
                      className="form-input form-input--plain"
                      value={s.name}
                      onChange={e => setService(idx, 'name', e.target.value)}
                      placeholder="ex. Formation secourisme (1 journée)"
                    />
                    <div className="pack-service-price">
                      <input
                        className="form-input form-input--plain"
                        type="number" min="0" step="0.01"
                        value={s.price}
                        onChange={e => setService(idx, 'price', e.target.value)}
                        placeholder="Prix"
                      />
                      <span className="pack-service-currency">DT</span>
                    </div>
                    <button type="button" className="pack-row-remove" onClick={() => removeService(idx)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="btn btn--ghost pack-add-service" onClick={addService}>
              <Plus size={14} /> Ajouter un service
            </button>
          </div>

          {/* ── Prix ── */}
          <div className="pack-section">
            <div className="pack-section-title"><Tag size={15} /> Tarification</div>
            <div className="pack-price-editor">
              <div className="pack-price-theo-box">
                <span className="pack-price-theo-label">Prix théorique (calculé)</span>
                <span className="pack-price-theo-big">{formatPrice(theoretical)}</span>
                <span className="pack-price-hint">Somme des produits × quantité + services</span>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Prix réel du pack <span className="form-label-opt">(prix négocié)</span></label>
                <div className="pack-service-price">
                  <input
                    className="form-input form-input--plain"
                    type="number" min="0" step="0.01"
                    value={realPrice}
                    onChange={e => setRealPrice(e.target.value)}
                    placeholder="ex. 2500"
                  />
                  <span className="pack-service-currency">DT</span>
                </div>
                {realPrice !== '' && !Number.isNaN(Number(realPrice)) && theoretical > 0 && (
                  Number(realPrice) <= theoretical ? (
                    <p className="pack-price-inline-save">
                      <Sparkles size={12} /> Économie {formatPrice(theoretical - Number(realPrice))} pour le client
                    </p>
                  ) : (
                    <p className="pack-price-inline-over">
                      <AlertTriangle size={12} /> Le prix réel dépasse le prix théorique
                    </p>
                  )
                )}
              </div>
            </div>
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : (isEdit ? 'Enregistrer' : 'Créer le pack')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Confirmation archivage ─── */
function ArchiveConfirm({ pack, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  async function confirm() {
    setLoading(true)
    try {
      await archivePack(pack._id)
      toast.success('Pack archivé.')
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Archiver le pack</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Voulez-vous archiver <strong>{pack.name}</strong> ?<br />
            Il pourra être restauré depuis l'onglet « Archivés ».
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
function DestroyConfirm({ pack, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [confirm, setConfirm] = useState('')
  async function handleDestroy() {
    setLoading(true)
    try {
      await destroyPack(pack._id)
      toast.success('Pack supprimé définitivement.')
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
            <p>Cette action est <strong>irréversible</strong>.</p>
          </div>
          <p className="delete-confirm-text" style={{ marginTop: 12 }}>
            Tapez le nom du pack pour confirmer : <strong>{pack.name}</strong>
          </p>
          <input
            className="form-input form-input--plain"
            style={{ marginTop: 10 }}
            placeholder={pack.name}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          {error && <div className="login-error" style={{ marginTop: 8 }}><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={handleDestroy} disabled={loading || confirm !== pack.name}>
              {loading ? <span className="login-btn-spinner" /> : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Page principale
   ───────────────────────────────────────────── */
export default function PacksPage() {
  const [tab,       setTab]       = useState('active')
  const [packs,     setPacks]     = useState([])
  const [products,  setProducts]  = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [search,    setSearch]    = useState('')
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [modal,     setModal]     = useState(null)   // 'create' | pack
  const [archiving, setArchiving] = useState(null)
  const [destroying,setDestroying]= useState(null)

  useLoadingBar(loading)

  const isArchived = tab === 'archived'
  const totalPages = Math.ceil(total / LIMIT)

  // Catalogue produits pour le sélecteur (chargé une fois)
  useEffect(() => {
    getProducts({ limit: 500, archived: 'false' })
      .then(res => setProducts(res.data || []))
      .catch(() => {})
  }, [])

  const fetchPacks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { page, limit: LIMIT, archived: isArchived ? 'true' : 'false' }
      if (search) params.search = search
      const res = await getPacks(params)
      setPacks(res.data || [])
      setTotal(res.total || 0)
    } catch (err) {
      const msg = formatApiError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [page, search, isArchived])

  useEffect(() => { fetchPacks() }, [fetchPacks])
  useEffect(() => { setPage(1) }, [search, tab])

  async function handleRestore(pack) {
    try {
      await restorePack(pack._id)
      toast.success(`${pack.name} restauré.`)
      fetchPacks()
    } catch (err) { toast.error(formatApiError(err)) }
  }

  function handleSaved()     { setModal(null);      fetchPacks() }
  function handleArchived()  { setArchiving(null);  fetchPacks() }
  function handleDestroyed() { setDestroying(null); fetchPacks() }

  return (
    <div className="page-content">
      {/* En-tête */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Packs</h1>
          <p className="page-subtitle">
            {total} pack{total !== 1 ? 's' : ''} {isArchived ? 'archivé' + (total !== 1 ? 's' : '') : 'actif' + (total !== 1 ? 's' : '')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn btn--ghost${isArchived ? ' btn--ghost-active' : ''}`}
            onClick={() => { setTab(isArchived ? 'active' : 'archived'); setSearch('') }}
          >
            <Archive size={14} /> {isArchived ? '← Packs actifs' : 'Archivés'}
          </button>
          {!isArchived && (
            <button className="btn btn--primary" onClick={() => setModal('create')}>
              <Plus size={15} /> Nouveau pack
            </button>
          )}
        </div>
      </div>

      {/* Recherche */}
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Rechercher un pack…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>
      </div>

      {/* Grille de packs */}
      {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : packs.length === 0 ? (
        <div className="table-empty">
          <Boxes size={36} color="var(--gray-300)" />
          <p>
            {search
              ? 'Aucun pack pour cette recherche.'
              : isArchived ? 'Aucun pack archivé.' : 'Aucun pack pour le moment.'}
          </p>
          {!search && !isArchived && (
            <button className="btn btn--primary" onClick={() => setModal('create')}>
              <Plus size={14} /> Créer le premier pack
            </button>
          )}
        </div>
      ) : (
        <div className="pack-grid">
          {packs.map(pack => (
            <PackCard
              key={pack._id}
              pack={pack}
              archived={isArchived}
              onEdit={p => setModal(p)}
              onArchive={p => setArchiving(p)}
              onRestore={handleRestore}
              onDestroy={p => setDestroying(p)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
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

      {/* Modals */}
      {(modal === 'create' || modal?._id) && (
        <PackModal
          pack={modal === 'create' ? null : modal}
          products={products}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {archiving && (
        <ArchiveConfirm pack={archiving} onClose={() => setArchiving(null)} onDone={handleArchived} />
      )}
      {destroying && (
        <DestroyConfirm pack={destroying} onClose={() => setDestroying(null)} onDone={handleDestroyed} />
      )}
    </div>
  )
}
