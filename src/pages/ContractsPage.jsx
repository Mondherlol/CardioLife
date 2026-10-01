import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Search, X, FileText, AlertTriangle, Archive, RotateCcw, Trash,
  Users, Building2, Calendar, Zap, Clock, CheckCircle2,
} from 'lucide-react'
import {
  getContracts, getContractStats, archiveContract, restoreContract, destroyContract,
  CONTRACT_STATUSES, formatPrice,
} from '../api/contracts'
import { useLoadingBar } from '../hooks/useLoadingBar'
import { useInfiniteList, useDebouncedValue } from '../hooks/useInfiniteList'
import ListFooter from '../components/ListFooter'

/* Lots chargés au défilement : un lot remplit largement un écran. */
const PAGE_SIZE = 30
const STATUS_MAP = Object.fromEntries(CONTRACT_STATUSES.map(s => [s.value, s]))

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}
function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function StatusBadge({ status }) {
  const s = STATUS_MAP[status]
  if (!s) return null
  return <span className={`ct-status ${s.cls}`}>{s.label}</span>
}

/* Confirmations réutilisables */
function ConfirmModal({ title, body, confirmLabel, danger, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  async function go() {
    setLoading(true)
    try { await onConfirm() } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {body}
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={go} disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ContractsPage() {
  const navigate = useNavigate()

  const [tab,        setTab]        = useState('active')
  const [stats,      setStats]      = useState(null)
  const [search,     setSearch]     = useState('')
  // Une requête par recherche, pas par lettre tapée.
  const query = useDebouncedValue(search.trim(), 300)
  const [statusF,    setStatusF]    = useState('')
  const [archiving,  setArchiving]  = useState(null)
  const [destroying, setDestroying] = useState(null)
  const tableWrapRef = useRef(null)

  const isArchived = tab === 'archived'

  const fetchStats = useCallback(async () => {
    try { setStats(await getContractStats()) } catch (_) {}
  }, [])

  const fetchPage = useCallback(({ skip, limit }) => {
    const params = { skip, limit, archived: isArchived ? 'true' : 'false' }
    if (query)   params.search = query
    if (statusF) params.status = statusF
    return getContracts(params)
  }, [query, statusF, isArchived])

  const {
    items: contracts, total, loading, loadingMore, error, hasMore, reload, retry, sentinelRef,
  } = useInfiniteList(fetchPage, [fetchPage], { pageSize: PAGE_SIZE })

  useLoadingBar(loading)

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { if (error) toast.error(error) }, [error])
  // Nouveaux critères : la liste repart du haut.
  useEffect(() => { if (tableWrapRef.current) tableWrapRef.current.scrollTop = 0 }, [fetchPage])

  /* Après une action sur une ligne : la liste se recharge sans perdre sa place. */
  function refresh() { reload(); fetchStats() }

  async function handleRestore(c) {
    try { await restoreContract(c._id); toast.success('Contrat restauré.'); refresh() }
    catch (err) { toast.error(formatApiError(err)) }
  }

  const statCards = stats ? [
    { icon: FileText,     label: 'Total contrats',  value: stats.total,    color: 'var(--orange-500)', bg: 'var(--orange-50)' },
    { icon: CheckCircle2, label: 'Actifs',          value: stats.actifs,   color: 'var(--green-600)',  bg: 'var(--green-50)'  },
    { icon: Clock,        label: 'Expirent < 30j',  value: stats.expirent, color: 'var(--amber-600)',  bg: 'var(--amber-50)', alert: stats.expirent > 0 },
    { icon: AlertTriangle,label: 'Échus',           value: stats.expires,  color: 'var(--red-600)',    bg: 'var(--red-50)',   alert: stats.expires > 0 },
  ] : []

  return (
    <div className="page-content page-content--table-scroll">
      {/* En-tête */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Contrats</h1>
          <p className="page-subtitle">
            {total} contrat{total !== 1 ? 's' : ''} {isArchived ? 'archivé' + (total !== 1 ? 's' : '') : 'enregistré' + (total !== 1 ? 's' : '')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn--ghost${isArchived ? ' btn--ghost-active' : ''}`}
            onClick={() => { setTab(isArchived ? 'active' : 'archived'); setSearch(''); setStatusF('') }}>
            <Archive size={14} /> {isArchived ? '← Contrats actifs' : 'Archivés'}
          </button>
          {/* Un contrat naît toujours d'un client : la création se fait sur sa fiche. */}
          {!isArchived && (
            <button className="btn btn--primary" onClick={() => navigate('/clients')}>
              <Users size={15} /> Nouveau contrat — choisir un client
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {!isArchived && stats && (
        <div className="stock-stats-grid">
          {statCards.map(card => {
            const Icon = card.icon
            return (
              <div key={card.label} className={`stock-stat-card${card.alert ? ' stock-stat-card--alert' : ''}`}>
                <div className="stock-stat-icon" style={{ background: card.bg }}>
                  <Icon size={18} color={card.color} />
                </div>
                <div className="stock-stat-body">
                  <div className="stock-stat-value" style={{ color: card.alert ? card.color : 'var(--text-primary)' }}>{card.value}</div>
                  <div className="stock-stat-label">{card.label}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recherche + filtres */}
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="Rechercher par n°, site ou client…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        {!isArchived && (
          <select className="cat-filter-select" value={statusF} onChange={e => setStatusF(e.target.value)}>
            <option value="">Tous les statuts</option>
            {CONTRACT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
      </div>

      {/* Tableau */}
      <div className="table-wrap" ref={tableWrapRef}>
        {error && !contracts.length && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}
        {loading ? (
          <div className="table-loading"><span className="spinner" /></div>
        ) : contracts.length === 0 ? (
          <div className="table-empty">
            <FileText size={36} color="var(--gray-300)" />
            <p>{query || statusF ? 'Aucun contrat pour ces critères.' : isArchived ? 'Aucun contrat archivé.' : 'Aucun contrat enregistré.'}</p>
            {!query && !isArchived && (
              <button className="btn btn--primary" onClick={() => navigate('/clients')}>
                <Users size={14} /> Créer un contrat depuis la fiche d'un client
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>N° de contrat</th>
                <th style={{ minWidth: 190 }}>Site couvert</th>
                <th style={{ minWidth: 170 }}>Client</th>
                <th>Statut</th>
                <th>Période</th>
                <th title="Augmente de 5 % deux mois avant chaque contrôle annuel">Prix</th>
                <th>Prochain contrôle</th>
                <th>DAE couverts</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c._id} className={isArchived ? 'row--archived' : 'mv-row--clickable'}
                  onClick={() => !isArchived && navigate(`/contrats/${c._id}`)}
                  title={isArchived ? '' : 'Voir le contrat'}>
                  <td>
                    <div className="cell-primary">{c.contractNumber || '—'}</div>
                    <div className="cell-secondary">Maintenance</div>
                  </td>
                  <td>
                    <div className="cell-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 size={13} color="var(--gray-300)" /> {c.site?.name || c.siteName || '—'}
                    </div>
                  </td>
                  <td>
                    <div className="cell-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={13} color="var(--gray-300)" /> {c.client?.name || c.clientName || '—'}
                    </div>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="cell-muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    <Calendar size={11} style={{ verticalAlign: -1 }} /> {formatDate(c.startDate)} → {formatDate(c.endDate)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {c.price != null ? (
                      <>
                        <div className="cell-primary">{formatPrice(c.price)}</div>
                        {c.priceIncreases?.length > 0 && (
                          <div className="cell-secondary">
                            +5 % le {formatDate(c.priceIncreases[c.priceIncreases.length - 1].appliedAt)}
                          </div>
                        )}
                      </>
                    ) : <span className="cell-muted">—</span>}
                  </td>
                  <td className="cell-muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {c.nextControlDate ? (
                      <span style={{ color: new Date(c.nextControlDate) < new Date() ? 'var(--red-600)' : undefined, fontWeight: new Date(c.nextControlDate) < new Date() ? 600 : undefined }}>
                        <Clock size={11} style={{ verticalAlign: -1 }} /> {formatDate(c.nextControlDate)}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <span className="ct-count-chip"><Zap size={11} /> {c.deaCount || 0}</span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      {isArchived ? (
                        <>
                          <button className="action-btn action-btn--restore" title="Restaurer" onClick={() => handleRestore(c)}>
                            <RotateCcw size={14} />
                          </button>
                          <button className="action-btn action-btn--destroy" title="Supprimer définitivement" onClick={() => setDestroying(c)}>
                            <Trash size={14} />
                          </button>
                        </>
                      ) : (
                        <button className="action-btn action-btn--delete" title="Archiver" onClick={() => setArchiving(c)}>
                          <Archive size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Fin de liste : la sentinelle charge le lot suivant à l'approche du bas. */}
        {!loading && contracts.length > 0 && (
          <ListFooter
            sentinelRef={sentinelRef}
            shown={contracts.length}
            total={total}
            hasMore={hasMore}
            loadingMore={loadingMore}
            error={error}
            onRetry={retry}
            noun={['contrat', 'contrats']}
          />
        )}
      </div>

      {archiving && (
        <ConfirmModal
          title="Archiver le contrat"
          confirmLabel="Archiver" danger
          body={<p className="delete-confirm-text">Archiver le contrat <strong>{archiving.contractNumber || archiving.clientName}</strong> ? Les installations liées restent dans le parc.</p>}
          onClose={() => setArchiving(null)}
          onConfirm={async () => { await archiveContract(archiving._id); toast.success('Contrat archivé.'); setArchiving(null); refresh() }}
        />
      )}
      {destroying && (
        <ConfirmModal
          title="Suppression définitive"
          confirmLabel="Supprimer définitivement" danger
          body={<div className="destroy-warning"><AlertTriangle size={18} /><p>Action <strong>irréversible</strong>. Les installations liées ne sont pas supprimées.</p></div>}
          onClose={() => setDestroying(null)}
          onConfirm={async () => { await destroyContract(destroying._id); toast.success('Contrat supprimé.'); setDestroying(null); refresh() }}
        />
      )}
    </div>
  )
}
