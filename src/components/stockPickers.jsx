import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, X, PackagePlus, Tag } from 'lucide-react'
import { getProducts, createProduct } from '../api/products'
import { getProductItems, createProductItems, itemStatus } from '../api/productItems'
import ComboSearch from './ComboSearch'

/**
 * Briques communes aux saisies « choisir dans le référentiel » : le modèle vient
 * du catalogue, l'exemplaire vient du stock, et une valeur inconnue passe par
 * une confirmation au lieu d'être créée en douce ou refusée sèchement.
 *
 * Partagé par la pose d'un DEA et par ses consommables (électrodes, batteries).
 */

export function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/**
 * Catalogue et stock d'une (ou plusieurs) catégorie(s), avec les deux créations
 * que les confirmations déclenchent.
 */
export function useCatalogStock(categories) {
  const key = Array.isArray(categories) ? categories.join(',') : categories
  const [products, setProducts] = useState([])
  const [stock,    setStock]    = useState([])

  const list = Array.isArray(categories) ? categories : [categories]

  useEffect(() => {
    Promise.all(list.map(c => getProducts({ category: c, limit: 200 })))
      .then(res => setProducts(res.flatMap(r => (Array.isArray(r.data) ? r.data : []))))
      .catch(() => {})
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadStock = useCallback(async () => {
    try {
      const res = await Promise.all(
        list.map(c => getProductItems({ category: c, inStock: 'true' }))
      )
      setStock(res.flatMap(r => (Array.isArray(r.data) ? r.data : [])))
    } catch {
      // Sans droit de lecture sur le stock la liste reste vide : la saisie
      // passe alors par la confirmation, qui affichera le refus de l'API.
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reloadStock() }, [reloadStock])

  /* Crée un modèle au catalogue et le rend disponible sans recharger la liste. */
  const addProduct = useCallback(async (name, category) => {
    const created = await createProduct({ name, category })
    const product = created?.data || created
    setProducts(l => [...l, product])
    return product
  }, [])

  /* Entre un exemplaire en stock puis rafraîchit la liste proposée. */
  const addStockItem = useCallback(async (product, { serialNumber, lotNumber, expirationDate } = {}) => {
    const payload = { product: product._id }
    if (serialNumber) payload.serialNumbers = [serialNumber]
    if (lotNumber)    payload.lotNumber     = lotNumber
    if (expirationDate) payload.expirationDate = expirationDate
    const res = await createProductItems(payload)
    await reloadStock()
    const created = res?.items?.[0]
    return { ...(created || {}), product, serialNumber, lotNumber }
  }, [reloadStock])

  return { products, stock, reloadStock, addProduct, addStockItem }
}

/** Ne garde du stock que ce qui est réellement posable pour ce modèle. */
export function stockOptionsFor(stock, { product, field }) {
  return stock.filter(it => {
    if (!it[field]) return false
    // Déjà rattaché à un DEA du parc : l'appareil est posé, pas disponible.
    if (it.dea) return false
    if (product && String(it.product?._id || it.product) !== String(product._id)) return false
    return true
  })
}

/** Choix d'un modèle au catalogue — jamais de saisie libre. */
export function ProductPicker({
  products, value, onChange, onClear, onUnknown, onQueryChange,
  placeholder, noun = 'modèle',
}) {
  const [query, setQuery] = useState('')
  return (
    <ComboSearch
      items={products}
      value={value}
      onChange={onChange}
      onClear={onClear}
      displayFn={p => p.name}
      subtextFn={p => [p.brand, p.reference].filter(Boolean).join(' · ')}
      placeholder={placeholder || `Rechercher un ${noun}…`}
      onQueryChange={q => { setQuery(q); onQueryChange?.(q) }}
      onCreateNew={onUnknown}
      emptyText={query ? `« ${query} » n'existe pas au catalogue` : `Aucun ${noun} au catalogue`}
      emptyCtaLabel={q => `Créer « ${q} » au catalogue`}
    />
  )
}

/**
 * Choix d'un exemplaire en stock, par numéro de série ou par numéro de lot.
 * `field` désigne celui des deux qui identifie l'article ici.
 */
export function StockPicker({
  items, value, onChange, onClear, onUnknown, onQueryChange, field, product, placeholder,
}) {
  const [query, setQuery] = useState('')
  const isSerial = field === 'serialNumber'
  const noun = isSerial ? 'n° de série' : 'n° de lot'

  return (
    <ComboSearch
      items={items}
      value={value}
      onChange={onChange}
      onClear={onClear}
      displayFn={it => it[field] || it.serialNumber || it.lotNumber || '—'}
      subtextFn={it => it.existing
        ? 'Déjà en place'
        : [
            it.product?.name,
            itemStatus(it.status).label,
            it.quantity > 1 ? `reste ${it.quantity}` : '',
          ].filter(Boolean).join(' · ')}
      placeholder={placeholder || `Rechercher un ${noun} en stock…`}
      onQueryChange={q => { setQuery(q); onQueryChange?.(q) }}
      onCreateNew={onUnknown}
      emptyText={query
        ? `« ${query} » n'est pas en stock`
        : product ? 'Rien de ce modèle en stock' : 'Rien en stock'}
      emptyCtaLabel={q => `Entrer « ${q} » en stock`}
    />
  )
}

/**
 * Confirmation d'une valeur absente du référentiel. Deux cas, même dialogue :
 * un modèle hors catalogue, ou un article hors stock. Refuser renvoie à la
 * saisie pour choisir une valeur existante.
 *
 * `mode` : 'product' | 'stock'
 */
export function ConfirmUnknown({
  mode, label, product, field = 'serialNumber', categoryLabel = 'produit',
  busy, error, onConfirm, onCancel,
}) {
  const isProduct = mode === 'product'
  // Entrer en stock suppose de savoir de quel modèle il s'agit.
  const blocked   = !isProduct && !product
  const noun      = field === 'serialNumber' ? 'n° de série' : 'n° de lot'

  return (
    <div className="modal-overlay modal-overlay--stacked"
      onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">{isProduct ? 'Modèle inconnu' : 'Article hors stock'}</h2>
          <button className="modal-close" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            {isProduct ? (
              <>Le modèle <strong>{label}</strong> n'existe pas au catalogue.
              {' '}Le créer maintenant comme {categoryLabel} ?</>
            ) : blocked ? (
              <>Le {noun} <strong>{label}</strong> n'est pas en stock. Choisissez
              {' '}d'abord un <strong>modèle</strong> pour pouvoir l'entrer en stock.</>
            ) : (
              <>Le {noun} <strong>{label}</strong> n'est pas en stock.
              {' '}L'entrer en stock comme <strong>{product.name}</strong> avant de le poser ?</>
            )}
          </p>
          {!isProduct && !blocked && (
            <p className="form-hint">L'article sera créé en stock, puis rattaché à l'enregistrement.</p>
          )}
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onCancel}>
              {blocked ? 'Fermer' : 'Non, choisir un autre'}
            </button>
            {!blocked && (
              <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={busy}>
                {busy ? <span className="login-btn-spinner" /> : (
                  isProduct
                    ? <><Tag size={14} /> Oui, créer le modèle</>
                    : <><PackagePlus size={14} /> Oui, entrer en stock</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
