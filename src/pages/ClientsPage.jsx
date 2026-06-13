import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Plus, Search, Pencil, Trash2, X, AlertTriangle,
  Building2, ChevronLeft, ChevronRight, RotateCcw, Trash, Archive, ArrowLeft,
  FileSpreadsheet,
} from 'lucide-react'
import { getClients, archiveClient, restoreClient, destroyClient } from '../api/clients'
import { getClientTypes } from '../api/clientTypes'
import { useLoadingBar } from '../hooks/useLoadingBar'
import ClientModal from '../components/ClientModal'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/* ─── Confirmation archivage ─── */
function ArchiveConfirm({ client, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function confirm() {
    setLoading(true)
    try {
      await archiveClient(client._id)
      toast.success('Client archivé.')
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Archiver le client</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Voulez-vous archiver <strong>{client.name}</strong> ?
            Il ne sera plus visible dans la liste active mais pourra être restauré.
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
function DestroyConfirm({ client, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [confirm, setConfirm] = useState('')

  async function handleDestroy() {
    setLoading(true)
    try {
      await destroyClient(client._id)
      toast.success('Client supprimé définitivement.')
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
            <p>Cette action est <strong>irréversible</strong>. Toutes les données de ce client seront perdues.</p>
          </div>
          <p className="delete-confirm-text" style={{ marginTop: 12 }}>
            Pour confirmer, tapez le nom du client : <strong>{client.name}</strong>
          </p>
          <input
            className="form-input form-input--plain"
            style={{ marginTop: 10 }}
            placeholder={client.name}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          {error && <div className="login-error" style={{ marginTop: 8 }}><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button
              className="btn btn--danger"
              onClick={handleDestroy}
              disabled={loading || confirm !== client.name}
            >
              {loading ? <span className="login-btn-spinner" /> : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Page principale ─── */
const LIMIT = 15

export default function ClientsPage() {
  const navigate = useNavigate()
  const [tab,        setTab]        = useState('active')   // 'active' | 'archived'
  const [clients,    setClients]    = useState([])
  const [types,      setTypes]      = useState([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')       // slug, '' = tous
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [modal,      setModal]      = useState(null)     // null | 'create' | client
  const [archiving,  setArchiving]  = useState(null)
  const [destroying, setDestroying] = useState(null)

  useLoadingBar(loading)

  const isArchived = tab === 'archived'
  const totalPages = Math.ceil(total / LIMIT)
  const typeMap    = Object.fromEntries(types.map(t => [t.slug, t.name]))

  useEffect(() => { getClientTypes().then(setTypes).catch(() => {}) }, [])

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { page, limit: LIMIT, archived: isArchived ? 'true' : 'false' }
      if (search)     params.search = search
      if (typeFilter) params.type   = typeFilter
      const res = await getClients(params)
      setClients(res.data)
      setTotal(res.total)
    } catch (err) {
      const msg = formatApiError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [page, search, typeFilter, isArchived])

  useEffect(() => { fetchClients() }, [fetchClients])
  useEffect(() => { setPage(1) },     [search, typeFilter, tab])

  async function handleRestore(client) {
    try {
      await restoreClient(client._id)
      toast.success(`${client.name} restauré.`)
      fetchClients()
    } catch (err) {
      toast.error(formatApiError(err))
    }
  }

  function handleSaved()     { setModal(null);     fetchClients() }
  function handleArchived()  { setArchiving(null); fetchClients() }
  function handleDestroyed() { setDestroying(null); fetchClients() }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {isArchived && (
              <button className="back-btn" onClick={() => setTab('active')}>
                <ArrowLeft size={16} />
              </button>
            )}
            {isArchived ? 'Clients archivés' : 'Clients'}
          </h1>
          <p className="page-subtitle">
            {total} client{total !== 1 ? 's' : ''} {isArchived ? 'archivé' : 'enregistré'}{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isArchived && (
            <button className="btn btn--ghost" onClick={() => setTab('archived')}>
              <Archive size={14} /> Archivés
            </button>
          )}
          {!isArchived && (
            <button className="btn btn--ghost" onClick={() => navigate('/clients/import')}>
              <FileSpreadsheet size={14} /> Importer
            </button>
          )}
          {!isArchived && (
            <button className="btn btn--primary" onClick={() => setModal('create')}>
              <Plus size={15} /> Nouveau client
            </button>
          )}
        </div>
      </div>

      {/* Barre recherche + filtres */}
      <div className="table-toolbar" style={{ flexDirection: 'column', gap: 10 }}>
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="Rechercher par nom, ville…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}><X size={13} /></button>
          )}
        </div>

        {types.length > 0 && !isArchived && (
          <div className="cl-type-filters">
            <button
              className={`cl-type-pill${typeFilter === '' ? ' cl-type-pill--active' : ''}`}
              onClick={() => setTypeFilter('')}
            >
              Tous
            </button>
            {types.map(t => (
              <button
                key={t._id}
                className={`cl-type-pill${typeFilter === t.slug ? ' cl-type-pill--active' : ''}`}
                onClick={() => setTypeFilter(prev => prev === t.slug ? '' : t.slug)}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="table-wrap">
        {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

        {loading ? (
          <div className="table-loading"><span className="spinner" /></div>
        ) : clients.length === 0 ? (
          <div className="table-empty">
            <Building2 size={36} color="var(--gray-300)" />
            <p>
              {search
                ? 'Aucun résultat pour cette recherche.'
                : isArchived
                  ? 'Aucun client archivé.'
                  : 'Aucun client enregistré.'
              }
            </p>
            {!search && !isArchived && (
              <button className="btn btn--primary" onClick={() => setModal('create')}>
                <Plus size={14} /> Créer le premier client
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Type</th>
                <th>Gouvernorat</th>
                <th>Contact</th>
                <th>Téléphone</th>
                <th style={{ width: isArchived ? 100 : 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c._id} className={isArchived ? 'row--archived' : ''}>
                  <td>
                    <button
                      type="button"
                      className="cell-primary cell-link"
                      style={{ display: 'block', width: '100%', textAlign: 'left' }}
                      onClick={() => navigate(`/clients/${c._id}`)}
                    >
                      {c.name}
                    </button>
                    {c.address?.city && <div className="cell-secondary">{c.address.city}</div>}
                  </td>
                  <td><span className="type-badge">{typeMap[c.type] || c.type}</span></td>
                  <td className="cell-muted">{c.address?.governorate || '—'}</td>
                  <td className="cell-muted">{c.contact?.name  || '—'}</td>
                  <td className="cell-muted">{c.contact?.phones?.[0] || '—'}</td>
                  <td>
                    <div className="row-actions">
                      {isArchived ? (
                        <>
                          <button
                            className="action-btn action-btn--restore"
                            title="Restaurer"
                            onClick={() => handleRestore(c)}
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            className="action-btn action-btn--destroy"
                            title="Supprimer définitivement"
                            onClick={() => setDestroying(c)}
                          >
                            <Trash size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="action-btn action-btn--edit" title="Modifier" onClick={() => setModal(c)}>
                            <Pencil size={14} />
                          </button>
                          <button className="action-btn action-btn--delete" title="Archiver" onClick={() => setArchiving(c)}>
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
        <ClientModal
          client={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {archiving && (
        <ArchiveConfirm client={archiving} onClose={() => setArchiving(null)} onDone={handleArchived} />
      )}
      {destroying && (
        <DestroyConfirm client={destroying} onClose={() => setDestroying(null)} onDone={handleDestroyed} />
      )}
    </div>
  )
}
