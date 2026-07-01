import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Plus, Search, X, FileText, AlertTriangle, Archive, RotateCcw, Trash,
  ChevronLeft, ChevronRight, Users, Calendar, Zap, Tag, Clock, CheckCircle2,
} from 'lucide-react'
import {
  getContracts, getContractStats, archiveContract, restoreContract, destroyContract,
  CONTRACT_TYPES, CONTRACT_STATUSES,
} from '../api/contracts'
import { useLoadingBar } from '../hooks/useLoadingBar'

const LIMIT = 20
const TYPE_MAP   = Object.fromEntries(CONTRACT_TYPES.map(t => [t.value, t.label]))
const STATUS_MAP = Object.fromEntries(CONTRACT_STATUSES.map(s => [s.value, s]))

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}
function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatPrice(v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toLocaleString('fr-FR')} DT`
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
  const [contracts,  setContracts]  = useState([])
  const [stats,      setStats]      = useState(null)
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [search,     setSearch]     = useState('')
  const [statusF,    setStatusF]    = useState('')
  const [typeF,      setTypeF]      = useState('')
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [archiving,  setArchiving]  = useState(null)
  const [destroying, setDestroying] = useState(null)

  useLoadingBar(loading)

  const isArchived = tab === 'archived'
  const totalPages = Math.ceil(total / LIMIT)

  const fetchStats = useCallback(async () => {
    try { setStats(await getContractStats()) } catch (_) {}
  }, [])

  const fetchContracts = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = { page, limit: LIMIT, archived: isArchived ? 'true' : 'false' }
      if (search)  params.search = search
      if (statusF) params.status = statusF
      if (typeF)   params.type   = typeF
      const res = await getContracts(params)
      setContracts(res.data || [])
      setTotal(res.total || 0)
    } catch (err) {
      const msg = formatApiError(err); setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }, [page, search, statusF, typeF, isArchived])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { fetchContracts() }, [fetchContracts])
  useEffect(() => { setPage(1) }, [search, tab, statusF, typeF])

  async function handleRestore(c) {
    try { await restoreContract(c._id); toast.success('Contrat restauré.'); fetchContracts(); fetchStats() }
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
            onClick={() => { setTab(isArchived ? 'active' : 'archived'); setSearch(''); setStatusF(''); setTypeF('') }}>
            <Archive size={14} /> {isArchived ? '← Contrats actifs' : 'Archivés'}
          </button>
          {!isArchived && (
            <button className="btn btn--primary" onClick={() => navigate('/contrats/new')}>
              <Plus size={15} /> Nouveau contrat
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
          <input className="search-input" placeholder="Rechercher par n° ou client…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        {!isArchived && (
          <>
            <select className="cat-filter-select" value={statusF} onChange={e => setStatusF(e.target.value)}>
              <option value="">Tous les statuts</option>
              {CONTRACT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className="cat-filter-select" value={typeF} onChange={e => setTypeF(e.target.value)}>
              <option value="">Tous les types</option>
              {CONTRACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Tableau */}
      <div className="table-wrap">
        {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}
        {loading ? (
          <div className="table-loading"><span className="spinner" /></div>
        ) : contracts.length === 0 ? (
          <div className="table-empty">
            <FileText size={36} color="var(--gray-300)" />
            <p>{search || statusF || typeF ? 'Aucun contrat pour ces critères.' : isArchived ? 'Aucun contrat archivé.' : 'Aucun contrat enregistré.'}</p>
            {!search && !isArchived && (
              <button className="btn btn--primary" onClick={() => navigate('/contrats/new')}>
                <Plus size={14} /> Créer le premier contrat
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>N° / Type</th>
                <th style={{ minWidth: 200 }}>Client</th>
                <th>Statut</th>
                <th>Période</th>
                <th>Installations</th>
                <th>Valeur estimée</th>
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
                    <div className="cell-secondary">{TYPE_MAP[c.type] || c.type}</div>
                  </td>
                  <td>
                    <div className="cell-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={13} color="var(--gray-300)" /> {c.client?.name || c.clientName || '—'}
                    </div>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="cell-muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    <Calendar size={11} style={{ verticalAlign: -1 }} /> {formatDate(c.startDate)} → {formatDate(c.endDate)}
                  </td>
                  <td>
                    <span className="ct-count-chip"><Zap size={11} /> {c.installations?.length || 0}</span>
                  </td>
                  <td className="cell-primary" style={{ fontWeight: 700 }}>{formatPrice(c.estimatedValue)}</td>
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
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15} /></button>
          <span className="pag-info">Page {page} / {totalPages}</span>
          <button className="pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={15} /></button>
        </div>
      )}

      {archiving && (
        <ConfirmModal
          title="Archiver le contrat"
          confirmLabel="Archiver" danger
          body={<p className="delete-confirm-text">Archiver le contrat <strong>{archiving.contractNumber || archiving.clientName}</strong> ? Les installations liées restent dans le parc.</p>}
          onClose={() => setArchiving(null)}
          onConfirm={async () => { await archiveContract(archiving._id); toast.success('Contrat archivé.'); setArchiving(null); fetchContracts(); fetchStats() }}
        />
      )}
      {destroying && (
        <ConfirmModal
          title="Suppression définitive"
          confirmLabel="Supprimer définitivement" danger
          body={<div className="destroy-warning"><AlertTriangle size={18} /><p>Action <strong>irréversible</strong>. Les installations liées ne sont pas supprimées.</p></div>}
          onClose={() => setDestroying(null)}
          onConfirm={async () => { await destroyContract(destroying._id); toast.success('Contrat supprimé.'); setDestroying(null); fetchContracts(); fetchStats() }}
        />
      )}
    </div>
  )
}
