import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Plus, Search, Trash2, X, AlertTriangle,
  Building2, RotateCcw, Trash, Archive, ArrowLeft,
  FileSpreadsheet, ArrowUp, ArrowDown, HeartPulse, CheckCircle2, MinusCircle,
} from 'lucide-react'
import { getClients, archiveClient, restoreClient, destroyClient, clientLogoUrl } from '../api/clients'
import { useLoadingBar } from '../hooks/useLoadingBar'
import { useInfiniteList, useDebouncedValue } from '../hooks/useInfiniteList'
import ClientModal from '../components/ClientModal'
import ListFooter from '../components/ListFooter'

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

/* ─── Prochain contrôle : date + urgence ─── */
function daysUntil(value) {
  const target = new Date(value)
  const now = new Date()
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((t - n) / 86400000)
}

function NextControlCell({ date }) {
  if (!date) return <span className="cell-muted">—</span>
  const days  = daysUntil(date)
  const level = days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok'
  const label = new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const hint  = days < 0
    ? `Dépassé de ${Math.abs(days)} j`
    : days === 0 ? "Aujourd'hui" : `Dans ${days} j`

  return (
    <span className={`next-ctrl next-ctrl--${level}`} title={hint}>
      {label}
    </span>
  )
}

/* ─── Consommables : l'état le plus préoccupant parmi tous les DEA du client ─── */
function dateTone(value) {
  const days = daysUntil(value)
  return days < 0 ? 'overdue' : days <= 60 ? 'soon' : 'ok'
}
const fmtShort = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`

function BatteryCell({ client: c }) {
  if (c.battLevel == null && !c.battExpiry) return <span className="cell-muted">—</span>
  const lvlTone = c.battLevel == null ? null : c.battLevel <= 25 ? 'overdue' : c.battLevel < 50 ? 'soon' : 'ok'
  const issues = [
    c.battExpiredCount > 0 && plural(c.battExpiredCount, 'périmée', 'périmées'),
    c.battLowCount > 0 && plural(c.battLowCount, 'faible', 'faibles'),
  ].filter(Boolean)
  return (
    <div className="conso-cell" title="Charge la plus basse et DLC la plus proche parmi les batteries du client">
      <div className="conso-cell-line">
        {lvlTone && <span className={`next-ctrl next-ctrl--${lvlTone}`}>{c.battLevel} %</span>}
        {c.battExpiry && <span className={`next-ctrl next-ctrl--${dateTone(c.battExpiry)}`}>{fmtShort(c.battExpiry)}</span>}
      </div>
      {issues.length > 0 && <span className="conso-cell-note">{issues.join(' · ')}</span>}
    </div>
  )
}

function ElectrodeCell({ client: c }) {
  if (!c.elecExpiry) return <span className="cell-muted">—</span>
  return (
    <div className="conso-cell" title="DLC la plus proche parmi les électrodes du client">
      <div className="conso-cell-line">
        <span className={`next-ctrl next-ctrl--${dateTone(c.elecExpiry)}`}>{fmtShort(c.elecExpiry)}</span>
      </div>
      {c.elecExpiredCount > 0 && (
        <span className="conso-cell-note">{plural(c.elecExpiredCount, 'périmée', 'périmées')}</span>
      )}
    </div>
  )
}

/* ─── Page principale ─── */
/* Lots chargés au défilement. Un lot couvre largement un écran : la liste se
   remplit d'un trait, le suivant part avant d'atteindre le bas. */
const PAGE_SIZE = 30
const CLIENTS_STATE_KEY = 'cardiotrack.clients.listState'
const SORT_FIELDS = ['name', 'sites', 'deas', 'nextControl', 'contract', 'createdAt', 'battLevel', 'battExpiry', 'elecExpiry']

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
  const [search,     setSearch]     = useState(savedState.current.search || '')
  // La requête attend une courte pause dans la frappe : une recherche, pas une par lettre.
  const query = useDebouncedValue(search.trim(), 300)
  // Les anciennes colonnes (ville, contact, téléphone) peuvent traîner en session.
  const [sortField,  setSortField]  = useState(
    SORT_FIELDS.includes(savedState.current.sortField) ? savedState.current.sortField : 'createdAt'
  )
  const [sortDir,    setSortDir]    = useState(savedState.current.sortDir || 'desc')
  const [modal,      setModal]      = useState(null)     // null | 'create' | client
  const [archiving,  setArchiving]  = useState(null)
  const [destroying, setDestroying] = useState(null)
  const tableWrapRef = useRef(null)
  const scrollTopRef = useRef(savedState.current.scrollTop || 0)
  // Le défilement mémorisé ne se rejoue qu'une fois, au retour sur la page.
  const restorePending = useRef(scrollTopRef.current > 0)

  const isArchived = tab === 'archived'

  const fetchPage = useCallback(({ skip, limit }) => {
    const params = { skip, limit, archived: isArchived ? 'true' : 'false', sort: sortField, dir: sortDir }
    if (query) params.search = query
    return getClients(params)
  }, [isArchived, sortField, sortDir, query])

  const {
    items: clients, total, loading, loadingMore, error, hasMore, reload, retry, sentinelRef,
  } = useInfiniteList(fetchPage, [fetchPage], {
    pageSize: PAGE_SIZE,
    // Au retour d'une fiche : tout ce qui était affiché revient d'un coup.
    initialCount: savedState.current.count || 0,
  })

  useLoadingBar(loading)

  useEffect(() => { if (error) toast.error(error) }, [error])

  const persist = useCallback(() => {
    sessionStorage.setItem(CLIENTS_STATE_KEY, JSON.stringify({
      tab, search: query, sortField, sortDir,
      scrollTop: scrollTopRef.current, count: clients.length,
    }))
  }, [tab, query, sortField, sortDir, clients.length])

  useEffect(() => { persist() }, [persist])

  useEffect(() => {
    if (loading || !restorePending.current || !tableWrapRef.current) return
    restorePending.current = false
    tableWrapRef.current.scrollTop = scrollTopRef.current
  }, [loading])

  /* Nouveaux critères : on repart du haut de la liste. */
  function resetScroll() {
    scrollTopRef.current = 0
    restorePending.current = false
    if (tableWrapRef.current) tableWrapRef.current.scrollTop = 0
  }

  function setSearchFilter(value) {
    resetScroll()
    setSearch(value)
  }

  function setTabAndReset(value) {
    resetScroll()
    setTab(value)
  }

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    resetScroll()
  }

  function sortMark(field) {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ArrowUp size={12} strokeWidth={2.2} className="th-sort-icon" />
      : <ArrowDown size={12} strokeWidth={2.2} className="th-sort-icon" />
  }

  // On note la position à chaque défilement ; la session n'est écrite qu'en
  // quittant la page, pas à chaque pixel.
  function saveScroll() {
    scrollTopRef.current = tableWrapRef.current?.scrollTop || 0
  }

  function openClient(id) {
    saveScroll()
    persist()
    navigate(`/clients/${id}`)
  }

  async function handleRestore(client) {
    try {
      await restoreClient(client._id)
      toast.success(`${client.name} restauré.`)
      reload()
    } catch (err) {
      toast.error(formatApiError(err))
    }
  }

  // Après création, on enchaîne directement sur la fiche du client pour y
  // ajouter ses sites et ses DEA.
  function handleSaved(saved) {
    setModal(null)
    if (saved?._id) {
      saveScroll()
      persist()
      navigate(`/clients/${saved._id}`)
      return
    }
    reload()
  }
  function handleArchived()  { setArchiving(null); reload() }
  function handleDestroyed() { setDestroying(null); reload() }

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
      </div>

      {/* Tableau */}
      <div className="table-wrap" ref={tableWrapRef} onScroll={saveScroll}>
        {error && !clients.length && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

        {loading ? (
          <div className="table-loading"><span className="spinner" /></div>
        ) : clients.length === 0 ? (
          <div className="table-empty">
            <Building2 size={36} color="var(--gray-300)" />
            <p>
              {query
                ? 'Aucun résultat pour cette recherche.'
                : isArchived
                  ? 'Aucun client archivé.'
                  : 'Aucun client enregistré.'
              }
            </p>
            {!query && !isArchived && (
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
                <th style={{ width: 110 }}>
                  <button className="th-sort-btn" onClick={() => toggleSort('sites')}>
                    Sites {sortMark('sites')}
                  </button>
                </th>
                <th style={{ width: 110 }}>
                  <button className="th-sort-btn" onClick={() => toggleSort('deas')}>
                    DEA {sortMark('deas')}
                  </button>
                </th>
                <th style={{ width: 170 }}>
                  <button className="th-sort-btn" onClick={() => toggleSort('nextControl')}>
                    Prochain contrôle {sortMark('nextControl')}
                  </button>
                </th>
                {/* Deux tris pour les batteries : la charge la plus basse, ou la
                    DLC la plus proche — les deux décident d'un appel. */}
                <th style={{ width: 190 }}>
                  <div className="th-sort-group">
                    <span>Batteries</span>
                    <button className={`th-sort-chip${sortField === 'battLevel' ? ' th-sort-chip--on' : ''}`}
                      onClick={() => toggleSort('battLevel')} title="Trier par charge la plus basse">
                      % {sortMark('battLevel')}
                    </button>
                    <button className={`th-sort-chip${sortField === 'battExpiry' ? ' th-sort-chip--on' : ''}`}
                      onClick={() => toggleSort('battExpiry')} title="Trier par DLC la plus proche">
                      DLC {sortMark('battExpiry')}
                    </button>
                  </div>
                </th>
                <th style={{ width: 150 }}>
                  <button className="th-sort-btn" onClick={() => toggleSort('elecExpiry')} title="Trier par DLC la plus proche">
                    Électrodes {sortMark('elecExpiry')}
                  </button>
                </th>
                <th style={{ width: 150 }}>
                  <button className="th-sort-btn" onClick={() => toggleSort('contract')}>
                    Contrat {sortMark('contract')}
                  </button>
                </th>
                <th style={{ width: isArchived ? 100 : 60 }}></th>
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
                    <div className="client-cell">
                      <span className="client-thumb">
                        {c.logo
                          ? <img src={clientLogoUrl(c.logo)} alt="" />
                          : <Building2 size={14} />}
                      </span>
                      <span className="cell-primary cell-link">{c.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="count-pill">
                      <Building2 size={11} /> {c.siteCount || 0}
                    </span>
                  </td>
                  <td>
                    <span className="count-pill count-pill--green">
                      <HeartPulse size={11} /> {c.deaCount || 0}
                    </span>
                  </td>
                  <td><NextControlCell date={c.nextControlDate} /></td>
                  <td><BatteryCell client={c} /></td>
                  <td><ElectrodeCell client={c} /></td>
                  <td>
                    {c.underContract ? (
                      <span className="contract-badge contract-badge--on">
                        <CheckCircle2 size={12} /> Sous contrat
                      </span>
                    ) : (
                      <span className="contract-badge contract-badge--off">
                        <MinusCircle size={12} /> Hors contrat
                      </span>
                    )}
                  </td>
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
                        <button className="action-btn action-btn--delete" title="Archiver" onClick={e => { e.stopPropagation(); setArchiving(c) }}>
                          <Trash2 size={14} />
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
        {!loading && clients.length > 0 && (
          <ListFooter
            sentinelRef={sentinelRef}
            shown={clients.length}
            total={total}
            hasMore={hasMore}
            loadingMore={loadingMore}
            error={error}
            onRetry={retry}
            noun={['client', 'clients']}
          />
        )}
      </div>

      {/* Modals */}
      {modal === 'create' && (
        <ClientModal
          client={null}
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
