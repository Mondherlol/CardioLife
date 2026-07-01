import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Plus, Search, Pencil, Trash2, X, AlertTriangle,
  Building2, ChevronLeft, ChevronRight, RotateCcw, Trash, Archive, ArrowLeft,
  FileSpreadsheet, Check, ChevronDown, ArrowUp, ArrowDown,
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
function ClientTypeSelector({ types, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function handlePointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  function toggle(slug) {
    onChange(
      selected.includes(slug)
        ? selected.filter(s => s !== slug)
        : [...selected, slug]
    )
  }

  const selectedLabels = types
    .filter(t => selected.includes(t.slug))
    .map(t => t.name)

  return (
    <div className="cl-type-select" ref={wrapRef}>
      <button
        type="button"
        className={`cl-type-select-btn${open ? ' cl-type-select-btn--open' : ''}${selected.length ? ' cl-type-select-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="cl-type-select-label">
          {selected.length === 0
            ? 'Tous les types'
            : selected.length === 1
              ? selectedLabels[0]
              : `${selected.length} types selectionnes`
          }
        </span>
        {selected.length > 0 && <span className="cl-type-select-count">{selected.length}</span>}
        <ChevronDown size={14} className="cl-type-select-chevron" />
      </button>

      {open && (
        <div className="cl-type-select-menu">
          <button
            type="button"
            className={`cl-type-select-option${selected.length === 0 ? ' cl-type-select-option--active' : ''}`}
            onClick={() => onChange([])}
          >
            <span className="cl-type-select-check">{selected.length === 0 && <Check size={12} />}</span>
            Tous les types
          </button>
          {types.map(t => {
            const active = selected.includes(t.slug)
            return (
              <button
                key={t._id}
                type="button"
                className={`cl-type-select-option${active ? ' cl-type-select-option--active' : ''}`}
                onClick={() => toggle(t.slug)}
              >
                <span className="cl-type-select-check">{active && <Check size={12} />}</span>
                <span>{t.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

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
const CLIENTS_STATE_KEY = 'cardiotrack.clients.listState'

function getSavedClientsState() {
  try {
    return JSON.parse(sessionStorage.getItem(CLIENTS_STATE_KEY) || '{}')
  } catch {
    return {}
  }
}

export default function ClientsPage() {
  const navigate = useNavigate()
  const savedState = useRef(getSavedClientsState())
  const [tab,        setTab]        = useState(savedState.current.tab || 'active')   // 'active' | 'archived'
  const [clients,    setClients]    = useState([])
  const [types,      setTypes]      = useState([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(savedState.current.page || 1)
  const [search,     setSearch]     = useState(savedState.current.search || '')
  const [typeFilter, setTypeFilter] = useState(Array.isArray(savedState.current.typeFilter) ? savedState.current.typeFilter : [])       // slugs, [] = tous
  const [sortField,  setSortField]  = useState(savedState.current.sortField || 'createdAt')
  const [sortDir,    setSortDir]    = useState(savedState.current.sortDir || 'desc')
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [modal,      setModal]      = useState(null)     // null | 'create' | client
  const [archiving,  setArchiving]  = useState(null)
  const [destroying, setDestroying] = useState(null)
  const tableWrapRef = useRef(null)
  const scrollTopRef = useRef(savedState.current.scrollTop || 0)

  useLoadingBar(loading)

  const isArchived = tab === 'archived'
  const totalPages = Math.ceil(total / LIMIT)
  const typeMap    = Object.fromEntries(types.map(t => [t.slug, t.name]))

  useEffect(() => { getClientTypes().then(setTypes).catch(() => {}) }, [])

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { page, limit: LIMIT, archived: isArchived ? 'true' : 'false', sort: sortField, dir: sortDir }
      if (search)     params.search = search
      if (typeFilter.length) params.type = typeFilter.join(',')
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
  }, [page, search, typeFilter, isArchived, sortField, sortDir])

  useEffect(() => { fetchClients() }, [fetchClients])

  useEffect(() => {
    sessionStorage.setItem(CLIENTS_STATE_KEY, JSON.stringify({
      tab, page, search, typeFilter, sortField, sortDir, scrollTop: scrollTopRef.current,
    }))
  }, [tab, page, search, typeFilter, sortField, sortDir])

  useEffect(() => {
    if (loading || !tableWrapRef.current) return
    tableWrapRef.current.scrollTop = scrollTopRef.current || 0
  }, [loading, clients])

  function setSearchFilter(value) {
    scrollTopRef.current = 0
    setSearch(value)
    setPage(1)
  }

  function setTypeFilterAndReset(value) {
    scrollTopRef.current = 0
    setTypeFilter(value)
    setPage(1)
  }

  function setTabAndReset(value) {
    scrollTopRef.current = 0
    setTab(value)
    setPage(1)
  }

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    scrollTopRef.current = 0
    setPage(1)
  }

  function changePage(nextPage) {
    scrollTopRef.current = 0
    setPage(nextPage)
  }

  function sortMark(field) {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ArrowUp size={12} strokeWidth={2.2} className="th-sort-icon" />
      : <ArrowDown size={12} strokeWidth={2.2} className="th-sort-icon" />
  }

  function saveScroll() {
    scrollTopRef.current = tableWrapRef.current?.scrollTop || 0
    sessionStorage.setItem(CLIENTS_STATE_KEY, JSON.stringify({
      tab, page, search, typeFilter, sortField, sortDir, scrollTop: scrollTopRef.current,
    }))
  }

  function openClient(id) {
    saveScroll()
    navigate(`/clients/${id}`)
  }

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
              <button className="back-btn" onClick={() => setTabAndReset('active')}>
                <ArrowLeft size={16} />
              </button>
            )}
            {isArchived ? 'Clients archivés' : 'Clients'}
          </h1>
          <p className="page-subtitle">
            {total} client{total !== 1 ? 's' : ''} {isArchived ? 'archivé' : 'enregistré'}{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="clients-header-actions">
          {!isArchived && (
            <button className="btn btn--ghost" onClick={() => setTabAndReset('archived')}>
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
      <div className="table-toolbar clients-toolbar">
        <div className="search-wrap">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="Rechercher par nom, ville…"
            value={search} onChange={e => setSearchFilter(e.target.value)} />
          {search && (
            <button className="search-clear" onClick={() => setSearchFilter('')}><X size={13} /></button>
          )}
        </div>

        {types.length > 0 && !isArchived && (
          <ClientTypeSelector
            types={types}
            selected={typeFilter}
            onChange={setTypeFilterAndReset}
          />
        )}
      </div>

      {/* Tableau */}
      <div className="table-wrap" ref={tableWrapRef} onScroll={saveScroll}>
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
                <th>
                  <button className="th-sort-btn" onClick={() => toggleSort('name')}>
                    Client {sortMark('name')}
                  </button>
                </th>
                <th>
                  <button className="th-sort-btn" onClick={() => toggleSort('type')}>
                    Type {sortMark('type')}
                  </button>
                </th>
                <th>
                  <button className="th-sort-btn" onClick={() => toggleSort('governorate')}>
                    Gouvernorat {sortMark('governorate')}
                  </button>
                </th>
                <th>
                  <button className="th-sort-btn" onClick={() => toggleSort('contactName')}>
                    Contact {sortMark('contactName')}
                  </button>
                </th>
                <th>
                  <button className="th-sort-btn" onClick={() => toggleSort('phone')}>
                    Téléphone {sortMark('phone')}
                  </button>
                </th>
                <th style={{ width: isArchived ? 100 : 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr
                  key={c._id}
                  className={`row--clickable${isArchived ? ' row--archived' : ''}`}
                  onClick={() => openClient(c._id)}
                >
                  <td>
                    <div className="cell-primary cell-link">{c.name}</div>
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
                            onClick={e => { e.stopPropagation(); handleRestore(c) }}
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            className="action-btn action-btn--destroy"
                            title="Supprimer définitivement"
                            onClick={e => { e.stopPropagation(); setDestroying(c) }}
                          >
                            <Trash size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="action-btn action-btn--edit" title="Modifier" onClick={e => { e.stopPropagation(); setModal(c) }}>
                            <Pencil size={14} />
                          </button>
                          <button className="action-btn action-btn--delete" title="Archiver" onClick={e => { e.stopPropagation(); setArchiving(c) }}>
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
          <button className="pag-btn" disabled={page === 1} onClick={() => changePage(page - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="pag-info">Page {page} / {totalPages}</span>
          <button className="pag-btn" disabled={page === totalPages} onClick={() => changePage(page + 1)}>
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
