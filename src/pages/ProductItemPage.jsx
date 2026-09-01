import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Hash, Layers, Truck, CalendarDays, Users, MapPin, Package,
  AlertTriangle, Clock, ShoppingCart, Wrench, PackageCheck, Ban,
  History, User, ExternalLink, Save, Pencil, HeartPulse, Trash2,
} from 'lucide-react'
import {
  getProductItem, updateProductItem, deleteProductItem, itemStatus,
} from '../api/productItems'
import { getProductCategories } from '../api/productCategories'
import { productImageUrl } from '../api/products'
import { useLoadingBar } from '../hooks/useLoadingBar'
import { ItemStatusChip, StatusConfirm, actionsFor, expiryLevel, formatDate } from '../components/ItemDrawer'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_ICONS = {
  disponible:  PackageCheck,
  reserve:     Clock,
  maintenance: Wrench,
  installe:    HeartPulse,
  vendu:       ShoppingCart,
  hs:          Ban,
}

/* Champs éditables en place — le reste de la fiche est du dérivé. */
const EDITABLE = [
  { key: 'reference',      label: 'Référence',      icon: Hash },
  { key: 'serialNumber',   label: 'N° de série',    icon: Hash,   mono: true },
  { key: 'lotNumber',      label: 'N° de lot',      icon: Layers, mono: true },
  { key: 'expirationDate', label: 'DLC',            icon: CalendarDays, type: 'date' },
  { key: 'supplier',       label: 'Fournisseur',    icon: Truck },
  { key: 'entryDate',      label: 'Date d\'entrée', icon: CalendarDays, type: 'date' },
  { key: 'purchasePrice',  label: 'Prix d\'achat',  icon: ShoppingCart, type: 'number' },
  { key: 'salePrice',      label: 'Prix de vente',  icon: ShoppingCart, type: 'number' },
]

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '')

/**
 * Le dossier de vie d'un exemplaire : son identité, sa situation actuelle, et
 * la chronologie complète de ce qui lui est arrivé — de la réception
 * fournisseur à la pose chez le client.
 *
 * C'est le point de jonction entre le stock et le parc : quand l'appareil est
 * posé, la fiche pointe vers le DEA, le site et le client.
 */
export default function ProductItemPage() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [item,       setItem]       = useState(null)
  const [categories, setCategories] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [editing,    setEditing]    = useState(false)
  const [form,       setForm]       = useState({})
  const [saving,     setSaving]     = useState(false)
  const [pending,    setPending]    = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)

  useLoadingBar(loading)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItem(await getProductItem(id))
    } catch {
      toast.error('Article introuvable.')
      navigate('/stock')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    getProductCategories().then(d => setCategories(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  if (loading || !item) {
    return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  }

  const category  = categories.find(c => c.slug === item.category) || null
  const product   = item.product || {}
  const exp       = expiryLevel(item.expirationDate)
  const StatusIcon = STATUS_ICONS[item.status] || Package
  const isLot     = !item.serialNumber && !!item.lotNumber
  const title     = item.serialNumber || item.lotNumber || item.reference || 'Article sans identifiant'

  function startEdit() {
    setForm(Object.fromEntries(EDITABLE.map(f => [
      f.key,
      f.type === 'date' ? toDateInput(item[f.key]) : (item[f.key] ?? ''),
    ])))
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
      )
      await updateProductItem(item._id, payload)
      // On relit la fiche : le PATCH ne renvoie ni le DEA ni le journal peuplé.
      setItem(await getProductItem(item._id))
      toast.success('Article mis à jour.')
      setEditing(false)
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      await deleteProductItem(item._id)
      toast.success('Article supprimé.')
      navigate(`/stock/${product._id || ''}`)
    } catch (err) {
      toast.error(formatApiError(err))
    }
  }

  return (
    <div className="page-content">
      {/* ── En-tête ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate(`/stock/${product._id || ''}`)}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="item-eyebrow">
              {product.images?.length > 0 && (
                <img className="item-eyebrow-thumb" src={productImageUrl(product.images[0])} alt="" />
              )}
              <button className="item-eyebrow-link" onClick={() => navigate(`/stock/${product._id}`)}>
                {product.name || 'Modèle'}
              </button>
              {category && <span className={`cat-badge cat--${category.color}`}>{category.name}</span>}
            </div>
            <h1 className="page-title item-title">{title}</h1>
            <div className="drawer-badges">
              <ItemStatusChip status={item.status} />
              {exp && (
                <span className={`item-exp item-exp--${exp.level}`}>
                  {exp.level === 'expired' ? <AlertTriangle size={11} /> : <Clock size={11} />}
                  DLC {formatDate(item.expirationDate)}{exp.level !== 'ok' ? ` · ${exp.label}` : ''}
                </span>
              )}
              {isLot && <span className="item-chip item-chip--slate">Lot · {item.quantity} unité{item.quantity > 1 ? 's' : ''}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button className="btn btn--ghost" onClick={() => setEditing(false)} disabled={saving}>Annuler</button>
              <button className="btn btn--primary" onClick={saveEdit} disabled={saving}>
                {saving ? <span className="login-btn-spinner" /> : <><Save size={14} /> Enregistrer</>}
              </button>
            </>
          ) : (
            <button className="btn btn--primary" onClick={startEdit}>
              <Pencil size={14} /> Modifier
            </button>
          )}
        </div>
      </div>

      <div className="item-layout">
        <div className="item-main">
          {/* ── Identité ── */}
          <div className="pd-section">
            <div className="pd-section-title"><Package size={14} /> Identité de l'article</div>
            <div className="pd-details-grid">
              {EDITABLE.map(f => {
                const Icon = f.icon
                const raw  = item[f.key]
                const shown = f.type === 'date' ? formatDate(raw)
                  : f.type === 'number' && raw != null && raw !== '' ? `${Number(raw).toLocaleString('fr-FR')} DT`
                  : raw
                return (
                  <div key={f.key} className="pd-detail-item">
                    <div className="pd-detail-label"><Icon size={11} /> {f.label}</div>
                    {editing ? (
                      <input
                        className="form-input form-input--plain"
                        type={f.type || 'text'}
                        value={form[f.key] ?? ''}
                        onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <div className={`pd-detail-value${f.mono ? ' drawer-mono' : ''}`}>
                        {shown || <span className="cell-muted">—</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Affectation : client, site, DEA du parc ── */}
          {(item.client || item.site || item.dea || item.reservedFor?.client) && (
            <div className="pd-section">
              <div className="pd-section-title"><Users size={14} /> Affectation</div>
              <div className="item-links">
                {(item.client || item.reservedFor?.client) && (
                  <button className="item-link" onClick={() => navigate(`/clients/${(item.client || item.reservedFor.client)._id}`)}>
                    <Users size={14} />
                    <span>
                      <strong>{(item.client || item.reservedFor.client).name}</strong>
                      <em>{item.client ? 'Client propriétaire' : 'Réservé pour'}</em>
                    </span>
                    <ExternalLink size={13} />
                  </button>
                )}
                {item.site && (
                  <div className="item-link item-link--static">
                    <MapPin size={14} />
                    <span>
                      <strong>{item.site.name}</strong>
                      <em>{[item.site.address?.street, item.site.address?.city].filter(Boolean).join(', ') || 'Site d\'installation'}</em>
                    </span>
                  </div>
                )}
                {item.dea && (
                  <button className="item-link" onClick={() => navigate(`/devices/${item.dea._id}`)}>
                    <HeartPulse size={14} />
                    <span>
                      <strong>DEA au parc{item.dea.location ? ` — ${item.dea.location}` : ''}</strong>
                      <em>
                        {item.dea.status === 'installe'
                          ? `Posé le ${formatDate(item.dea.installationDate) || '—'}`
                          : 'Pose planifiée'}
                        {item.dea.nextControlDate ? ` · prochain contrôle ${formatDate(item.dea.nextControlDate)}` : ''}
                      </em>
                    </span>
                    <ExternalLink size={13} />
                  </button>
                )}
                {item.entryMovement && (
                  <div className="item-link item-link--static">
                    <Truck size={14} />
                    <span>
                      <strong>{item.entryMovement.reason || 'Entrée en stock'}</strong>
                      <em>
                        {formatDateTime(item.entryMovement.createdAt)}
                        {item.entryMovement.createdBy
                          ? ` · ${item.entryMovement.createdBy.fullName || item.entryMovement.createdBy.username}`
                          : ''}
                      </em>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Journal de vie ── */}
          <div className="pd-section">
            <div className="pd-section-title">
              <History size={14} /> Journal de vie
              <span className="pd-count">{item.history?.length || 0}</span>
            </div>
            {!item.history?.length ? (
              <div className="pd-empty">
                <History size={28} color="var(--gray-300)" />
                <p>Aucun événement enregistré pour cet article.</p>
              </div>
            ) : (
              <ol className="item-timeline">
                {[...item.history].reverse().map((h, i) => {
                  const Icon = STATUS_ICONS[h.to] || History
                  return (
                    <li key={i} className={`item-tl-row item-tl-row--${itemStatus(h.to).tone}`}>
                      <span className="item-tl-dot"><Icon size={12} /></span>
                      <div className="item-tl-body">
                        <div className="item-tl-action">{h.action}</div>
                        {h.note && <div className="item-tl-note">{h.note}</div>}
                        <div className="mv-meta">
                          {(h.user?.fullName || h.user?.username) && (
                            <span><User size={10} /> {h.user.fullName || h.user.username}</span>
                          )}
                          <span>{formatDateTime(h.date)}</span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>

        {/* ── Colonne d'actions ── */}
        <aside className="item-aside">
          <div className="pd-section">
            <div className="pd-section-title"><StatusIcon size={14} /> Situation</div>
            <div className="item-status-block">
              <ItemStatusChip status={item.status} />
              {item.reservedFor?.note && <p className="drawer-note"><Clock size={12} /> {item.reservedFor.note}</p>}
              {item.saleDate && <p className="drawer-note"><ShoppingCart size={12} /> Vendu le {formatDate(item.saleDate)}</p>}
            </div>

            {pending ? (
              <StatusConfirm
                item={item}
                target={pending}
                onCancel={() => setPending(null)}
                onDone={() => { setPending(null); load() }}
              />
            ) : (
              <div className="drawer-actions">
                {/* Les gestes qui ont un sens depuis l'état courant, et eux
                    seuls : « installer » ou « réserver » un article déjà vendu
                    n'en a aucun, et la liste complète noyait les deux actions
                    réellement utiles. */}
                {actionsFor(item.status).map(a => {
                  const Icon = a.icon || STATUS_ICONS[a.status] || Package
                  return (
                    <button key={a.status}
                      className={`drawer-action${a.danger ? ' drawer-action--danger' : ''}`}
                      onClick={() => setPending(a.status)}>
                      <Icon size={14} /> {a.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="pd-section">
            <div className="pd-section-title"><Trash2 size={14} /> Retirer du parc</div>
            {confirmDel ? (
              <div className="drawer-confirm">
                <div className="drawer-confirm-title">
                  Supprimer définitivement cet article ? Son historique sera perdu.
                </div>
                <div className="drawer-confirm-actions">
                  <button className="btn btn--ghost" onClick={() => setConfirmDel(false)}>Annuler</button>
                  <button className="btn btn--danger" onClick={handleDelete}>Supprimer</button>
                </div>
              </div>
            ) : (
              <button className="drawer-action drawer-action--danger" onClick={() => setConfirmDel(true)}>
                <Trash2 size={14} /> Supprimer l'article
              </button>
            )}
            <p className="form-hint" style={{ marginTop: 8 }}>
              À réserver aux saisies erronées. Un appareil sorti du stock se marque « vendu »
              ou « hors service » — il garde ainsi sa trace.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
