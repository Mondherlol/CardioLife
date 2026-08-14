import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'react-toastify'
import {
  Search, X, Plus, AlertTriangle, Boxes, PackageOpen, Clock,
  Wrench, CalendarClock, Package,
} from 'lucide-react'
import {
  getProductItems, createProductItems, ITEM_STATUSES,
} from '../api/productItems'
import { assignSerials } from '../api/products'
import ItemDrawer, { ItemStatusChip, expiryLevel, formatDate } from './ItemDrawer'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/* ─── Réception : crée les exemplaires d'une livraison ─── */
function ReceiveModal({ product, category, onClose, onDone }) {
  const bySerial = !!category?.tracksSerial
  const [serialsText,    setSerialsText]    = useState('')
  const [quantity,       setQuantity]       = useState('1')
  const [lotNumber,      setLotNumber]      = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [supplier,       setSupplier]       = useState(product.supplier || '')
  const [entryDate,      setEntryDate]      = useState(() => new Date().toISOString().slice(0, 10))
  const [reference,      setReference]      = useState(product.reference || '')
  const [error,          setError]          = useState('')
  const [loading,        setLoading]        = useState(false)

  const serials = serialsText.split('\n').map(s => s.trim()).filter(Boolean)
  const dupes   = serials.filter((sn, i) => serials.indexOf(sn) !== i)
  const count   = bySerial ? serials.length : Number(quantity) || 0
  const canSubmit = count > 0 && dupes.length === 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setError(''); setLoading(true)
    try {
      const res = await createProductItems({
        product: product._id,
        serialNumbers: bySerial ? serials : undefined,
        quantity: bySerial ? undefined : count,
        reference, supplier, entryDate,
        lotNumber:      lotNumber || undefined,
        expirationDate: expirationDate || undefined,
        reason: 'Réception fournisseur',
      })
      toast.success(`${res.created} article${res.created > 1 ? 's' : ''} enregistré${res.created > 1 ? 's' : ''}.`)
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
          <div>
            <h2 className="modal-title">Réceptionner des articles</h2>
            <div className="modal-subtitle">{product.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">

          {bySerial ? (
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Numéros de série <span style={{ color: 'var(--red-500)' }}>*</span></span>
                <span className={`adj-serial-count${serials.length > 0 ? ' adj-serial-count--ok' : ''}`}>
                  {serials.length} article{serials.length !== 1 ? 's' : ''}
                </span>
              </label>
              <textarea
                className="form-input form-input--plain form-textarea"
                rows={6}
                value={serialsText}
                onChange={e => setSerialsText(e.target.value)}
                placeholder={"Un numéro de série par ligne\nex. X13E012345\nX13E012346"}
                autoFocus
              />
              <p className="adj-serial-hint">Un exemplaire sera créé par ligne — vous pouvez coller depuis un scanner</p>
              {dupes.length > 0 && (
                <div className="adj-serial-warn">
                  <AlertTriangle size={12} /> En double : {[...new Set(dupes)].join(', ')}
                </div>
              )}
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Quantité <span style={{ color: 'var(--red-500)' }}>*</span></label>
              <input className="form-input form-input--plain" type="number" min="1"
                value={quantity} onChange={e => setQuantity(e.target.value)} required autoFocus />
            </div>
          )}

          {category?.tracksLot && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">N° de lot</label>
                <input className="form-input form-input--plain" value={lotNumber}
                  onChange={e => setLotNumber(e.target.value)} placeholder="LOT-2026-001" />
              </div>
              <div className="form-group">
                <label className="form-label">DLC</label>
                <input className="form-input form-input--plain" type="date"
                  value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Référence</label>
              <input className="form-input form-input--plain" value={reference}
                onChange={e => setReference(e.target.value)} placeholder={product.reference || 'Réf. article'} />
            </div>
            <div className="form-group">
              <label className="form-label">Fournisseur</label>
              <input className="form-input form-input--plain" value={supplier}
                onChange={e => setSupplier(e.target.value)} placeholder="Fournisseur" />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Date d'entrée</label>
            <input className="form-input form-input--plain" type="date"
              value={entryDate} onChange={e => setEntryDate(e.target.value)} />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !canSubmit}>
              {loading ? <span className="login-btn-spinner" />
                : `Enregistrer ${count || ''} article${count > 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Détailler les unités anonymes ───────────────────────
   Le stock repris de l'ancien système arrive en lignes groupées sans numéro.
   Cette saisie les éclate en exemplaires, sans toucher au total. */
function AssignSerialsModal({ product, untracked, knownSerials, onClose, onDone }) {
  const [serialsText, setSerialsText] = useState('')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  const serials = serialsText.split('\n').map(s => s.trim()).filter(Boolean)
  const dupes   = serials.filter((sn, i) => serials.indexOf(sn) !== i)
  const already = serials.filter(sn => knownSerials.includes(sn))
  const tooMany = serials.length > untracked
  const canSubmit = serials.length > 0 && !tooMany && dupes.length === 0 && already.length === 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setError(''); setLoading(true)
    try {
      await assignSerials(product._id, { serialNumbers: serials })
      toast.success('Numéros de série enregistrés.')
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
          <div>
            <h2 className="modal-title">Détailler les unités sans numéro</h2>
            <div className="modal-subtitle">{product.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {untracked} unité{untracked > 1 ? 's' : ''} en stock n'{untracked > 1 ? 'ont' : 'a'} pas de numéro
            de série. Chaque numéro saisi devient un article à part entière.{' '}
            <strong>Le total en stock ne change pas.</strong>
          </p>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Numéros de série</span>
              <span className={`adj-serial-count${serials.length > 0 && !tooMany ? ' adj-serial-count--ok' : tooMany ? ' adj-serial-count--err' : ''}`}>
                {serials.length} / {untracked}
              </span>
            </label>
            <textarea
              className="form-input form-input--plain form-textarea"
              rows={Math.max(3, Math.min(untracked, 8))}
              value={serialsText}
              onChange={e => setSerialsText(e.target.value)}
              placeholder={"Un numéro de série par ligne\nex. X13E012345"}
              autoFocus
            />
            <p className="adj-serial-hint">Un numéro par ligne — vous pouvez coller depuis un scanner</p>
            {tooMany && (
              <div className="adj-serial-warn"><AlertTriangle size={12} /> Trop de numéros : {untracked} maximum.</div>
            )}
            {dupes.length > 0 && (
              <div className="adj-serial-warn"><AlertTriangle size={12} /> En double : {[...new Set(dupes)].join(', ')}</div>
            )}
            {already.length > 0 && (
              <div className="adj-serial-warn"><AlertTriangle size={12} /> Déjà enregistré : {already.join(', ')}</div>
            )}
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !canSubmit}>
              {loading ? <span className="login-btn-spinner" /> : 'Enregistrer les séries'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Le parc d'un produit : la barre de compteurs en tête, puis la liste détaillée
 * des exemplaires.
 */
export default function ProductItemsTab({ product, category, onStockChanged }) {
  const [items,   setItems]   = useState([])
  const [summary, setSummary] = useState({})
  const [loading, setLoading] = useState(true)

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('')

  const [drawerId,  setDrawerId]  = useState(null)
  const [receiving, setReceiving] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const tracksLot = !!category?.tracksLot

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getProductItems({ product: product._id })
      setItems(Array.isArray(res.data) ? res.data : [])
      setSummary(res.summary || {})
    } catch (err) {
      toast.error(formatApiError(err))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [product._id])

  useEffect(() => { load() }, [load])

  // Le filtrage est local : la liste tient en mémoire et la frappe reste fluide.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(it => {
      if (q && ![it.serialNumber, it.reference, it.lotNumber, it.supplier, it.client?.name]
        .some(v => v?.toLowerCase().includes(q))) return false
      if (statusFilter && it.status !== statusFilter) return false
      if (expiryFilter) {
        const exp = expiryLevel(it.expirationDate)
        if (!exp) return false
        if (expiryFilter === 'expired') return exp.days < 0
        return exp.days >= 0 && exp.days <= Number(expiryFilter)
      }
      return true
    })
  }, [items, search, statusFilter, expiryFilter])

  const drawerItem = items.find(i => i._id === drawerId) || null

  /* Lignes groupées sans identifiant : héritage de l'ancien stock, à éclater en
     exemplaires tant que le produit demande des numéros de série. */
  const untracked = items
    .filter(i => !i.serialNumber && !i.lotNumber && ['disponible', 'reserve', 'maintenance'].includes(i.status))
    .reduce((n, i) => n + (i.quantity ?? 1), 0)
  const knownSerials = items.map(i => i.serialNumber).filter(Boolean)
  const canAssign = product.requiresSerialNumber && untracked > 0

  function handleChanged(updated) {
    setItems(list => list.map(i => (i._id === updated._id ? updated : i)))
    load()
    onStockChanged?.()
  }

  const stats = [
    { key: 'total',  tone: 'slate', icon: Boxes,         label: 'Stock actuel',    value: summary.total       ?? 0 },
    { key: 'dispo',  tone: 'mint',  icon: PackageOpen,   label: 'Disponible',      value: summary.disponible  ?? 0 },
    { key: 'resa',   tone: 'sky',   icon: Clock,         label: 'Réservé',         value: summary.reserve     ?? 0 },
    { key: 'maint',  tone: 'sun',   icon: Wrench,        label: 'En maintenance',  value: summary.maintenance ?? 0, alert: true },
    ...(tracksLot ? [{
      key: 'dlc', tone: 'ember', icon: CalendarClock, alert: true,
      label: summary.expired > 0 ? 'DLC dépassée' : 'DLC sous 90 j',
      value: summary.expired > 0 ? summary.expired : (summary.expiringSoon ?? 0),
      hint: summary.nextExpiry ? `Prochaine : ${formatDate(summary.nextExpiry)}` : null,
    }] : []),
  ]

  return (
    <>
      {/* ── Barre de compteurs ── */}
      <div className="cat-stats-row">
        {stats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.key}
              className={`cat-stat cat-stat--${s.tone}${s.alert && s.value > 0 ? ' cat-stat--alert' : ''}`}>
              <span className="cat-stat-icon"><Icon size={15} strokeWidth={2.2} /></span>
              <span className="cat-stat-value">{s.value}</span>
              <span className="cat-stat-label">{s.label}</span>
              {s.hint && <span className="cat-stat-hint">{s.hint}</span>}
            </div>
          )
        })}
      </div>

      {canAssign && (
        <div className="pd-serial-warn-banner">
          <AlertTriangle size={14} />
          <div>
            <strong>{untracked} unité{untracked > 1 ? 's' : ''} sans numéro de série</strong>
            <span>Ce produit demande des numéros de série. Détaillez ces unités pour les suivre une par une.</span>
          </div>
          <button className="btn btn--sm btn--primary" onClick={() => setAssigning(true)}>
            Saisir les séries
          </button>
        </div>
      )}

      {/* ── Filtres ── */}
      <div className="table-toolbar cat-filters">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="N° de série, lot, fournisseur, client…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>

        <select className="cat-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tous les statuts</option>
          {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {tracksLot && (
          <select className="cat-filter-select" value={expiryFilter} onChange={e => setExpiryFilter(e.target.value)}>
            <option value="">Toutes DLC</option>
            <option value="expired">DLC dépassée</option>
            <option value="30">Expire sous 30 j</option>
            <option value="90">Expire sous 90 j</option>
          </select>
        )}

        <button className="btn btn--primary" style={{ marginLeft: 'auto' }} onClick={() => setReceiving(true)}>
          <Plus size={14} /> Réceptionner
        </button>
      </div>

      {/* ── Liste détaillée ── */}
      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="table-empty">
          <Package size={36} color="var(--gray-300)" />
          <p>Aucun article enregistré pour ce modèle.</p>
          <button className="btn btn--primary" onClick={() => setReceiving(true)}>
            <Plus size={14} /> Réceptionner des articles
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="table-empty">
          <Package size={36} color="var(--gray-300)" />
          <p>Aucun article ne correspond à ces filtres.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table item-table">
            <thead>
              <tr>
                <th>Référence</th>
                <th>N° de série</th>
                <th>Fournisseur</th>
                <th>Date d'entrée</th>
                <th>Date de vente</th>
                <th>Client</th>
                {tracksLot && <th>DLC</th>}
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(it => {
                const exp   = expiryLevel(it.expirationDate)
                const isLot = !it.serialNumber && !!it.lotNumber
                return (
                  <tr key={it._id} className="mv-row--clickable" onClick={() => setDrawerId(it._id)}>
                    <td>{it.reference || <span className="cell-muted">—</span>}</td>
                    <td>
                      {it.serialNumber
                        ? <span className="mv-serial-chip">{it.serialNumber}</span>
                        : isLot
                          ? <span className="mv-lot-chip">{it.lotNumber} × {it.quantity}</span>
                          : <span className="cell-muted">{it.quantity > 1 ? `${it.quantity} unités` : '—'}</span>}
                    </td>
                    <td className="cell-muted">{it.supplier || '—'}</td>
                    <td className="cell-muted">{formatDate(it.entryDate) || '—'}</td>
                    <td className="cell-muted">{formatDate(it.saleDate) || '—'}</td>
                    <td>
                      {it.client?.name || it.reservedFor?.client?.name
                        ? <span className="cell-primary">{it.client?.name || it.reservedFor.client.name}</span>
                        : <span className="cell-muted">—</span>}
                    </td>
                    {tracksLot && (
                      <td>
                        {exp
                          ? <span className={`item-exp item-exp--${exp.level}`}>
                              {formatDate(it.expirationDate)}{exp.level !== 'ok' ? ` · ${exp.label}` : ''}
                            </span>
                          : <span className="cell-muted">—</span>}
                      </td>
                    )}
                    <td><ItemStatusChip status={it.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerItem && (
        <ItemDrawer
          item={drawerItem}
          category={category}
          onClose={() => setDrawerId(null)}
          onChanged={handleChanged}
        />
      )}
      {receiving && (
        <ReceiveModal
          product={product}
          category={category}
          onClose={() => setReceiving(false)}
          onDone={() => { setReceiving(false); load(); onStockChanged?.() }}
        />
      )}
      {assigning && (
        <AssignSerialsModal
          product={product}
          untracked={untracked}
          knownSerials={knownSerials}
          onClose={() => setAssigning(false)}
          onDone={() => { setAssigning(false); load(); onStockChanged?.() }}
        />
      )}
    </>
  )
}
