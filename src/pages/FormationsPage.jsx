import { useState, useEffect, useMemo } from 'react'
import { toast } from 'react-toastify'
import {
  GraduationCap, Plus, FileText, Calendar, Trash2, Check,
  X, History, CheckCircle2, Circle, Search, Building2, Clock,
} from 'lucide-react'
import {
  getAllFormations, deleteFormation, toggleAttestation,
} from '../api/formations'
import { lookupClients } from '../api/clients'
import { getUsers } from '../api/users'
import { useLoadingBar } from '../hooks/useLoadingBar'
import EventModal from '../components/EventModal'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtShort(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function initials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

/* ─── Client picker (créer une formation pour n'importe quel client) ── */
function ClientPickerModal({ onClose, onSelect }) {
  const [q,       setQ]       = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      lookupClients({ q, limit: 20 })
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <span className="modal-title">Choisir un client</span>
          <button className="modal-close" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, opacity: 0.5 }} />
              <input
                autoFocus
                className="form-input"
                style={{ paddingLeft: 32 }}
                placeholder="Rechercher un client…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
          </div>
          {loading ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : results.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aucun client trouvé.</p>
          ) : (
            <div className="fmn-doc-list">
              {results.map(c => (
                <button
                  key={c._id}
                  type="button"
                  className="fmn-doc-row"
                  style={{ width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
                  onClick={() => onSelect(c)}
                >
                  <span className="fmn-doc-link">
                    <Building2 size={14} />
                    <span className="fmn-doc-name">{c.name}</span>
                  </span>
                  {c.address?.city && (
                    <span className="fmn-doc-meta"><span>{c.address.city}</span></span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Modal : formations d'un client ────────────────────────── */
function ClientFormationsModal({ group, onClose, onToggleAttestation, onDelete, onOpenDetail, onCreate }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal--md">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="fmn-client-avatar">{initials(group.clientName)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span className="modal-title">{group.clientName}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {group.formations.length} formation{group.formations.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <button className="modal-close" type="button" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn--primary btn--sm" onClick={onCreate}>
              <Plus size={13} /> Nouvelle formation
            </button>
          </div>

          <div className="fmn-list">
            {group.formations.map(f => (
              <div
                key={f._id}
                className={`fmn-card ${f.attestationDelivered ? 'fmn-card--done' : ''}`}
                onClick={() => onOpenDetail(f._id)}
              >
                <button
                  className={`fmn-attest-btn ${f.attestationDelivered ? 'fmn-attest-btn--done' : ''}`}
                  onClick={e => { e.stopPropagation(); onToggleAttestation(f._id) }}
                  title={f.attestationDelivered ? 'Retirer la livraison des attestations' : 'Marquer les attestations comme livrées'}
                >
                  {f.attestationDelivered ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </button>

                <div className="fmn-card-body-row">
                  <div className="fmn-title-group">
                    <span className="fmn-title">{f.title}</span>
                    <span className="fmn-date"><Calendar size={11} /> {fmtDate(f.date)}</span>
                  </div>

                  <div className="fmn-card-chips">
                    {f.attestationDelivered ? (
                      <span className="fmn-chip fmn-chip--done">
                        <Check size={10} strokeWidth={3} /> Attestations livrées
                      </span>
                    ) : (
                      <span className="fmn-chip fmn-chip--pending">En attente</span>
                    )}
                    <span className="fmn-chip fmn-chip--neutral">
                      <FileText size={10} /> {f.documents.length} doc{f.documents.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div className="fmn-card-actions">
                  <button
                    className="fmn-icon-btn fmn-icon-btn--history"
                    onClick={e => { e.stopPropagation(); onOpenDetail(f._id) }}
                    title="Voir les détails / historique"
                  >
                    <History size={14} />
                  </button>
                  <button
                    className="fmn-icon-btn fmn-icon-btn--delete"
                    onClick={e => onDelete(f._id, e)}
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main page ─────────────────────────────────────────────── */
export default function FormationsPage() {
  const [formations,  setFormations]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [creatingFor, setCreatingFor] = useState(null)  // { id, name }
  const [detailId,    setDetailId]    = useState(null)
  const [openClient,  setOpenClient]  = useState(null)  // clé du groupe client ouvert en modal
  const [users,       setUsers]       = useState([])

  useLoadingBar(loading)

  useEffect(() => {
    getAllFormations()
      .then(data => { setFormations(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    getUsers().then(data => setUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  function update(updated) {
    setFormations(prev => prev.map(f => f._id === updated._id ? updated : f))
  }

  async function handleToggleAttestation(id) {
    try {
      const updated = await toggleAttestation(id)
      update(updated)
    } catch { toast.error("Erreur lors de la mise à jour de l'attestation.") }
  }

  async function handleDelete(id, e) {
    e?.stopPropagation()
    if (!window.confirm('Supprimer cette formation ? Cette action est irréversible.')) return
    try {
      await deleteFormation(id)
      setFormations(prev => prev.filter(f => f._id !== id))
      if (detailId === id) setDetailId(null)
      toast.success('Formation supprimée.')
    } catch { toast.error('Erreur lors de la suppression.') }
  }

  function handleCreated(f) {
    setFormations(prev => [f, ...prev])
    setCreatingFor(null)
    setDetailId(f._id)
    toast.success('Formation créée.')
  }

  /* Regroupement par client */
  const groups = useMemo(() => {
    const map = new Map()
    for (const f of formations) {
      const clientId = typeof f.client === 'object' ? f.client?._id : f.client
      const key = clientId || f.clientName || 'inconnu'
      if (!map.has(key)) {
        map.set(key, { key, clientId, clientName: f.clientName || 'Client inconnu', formations: [] })
      }
      map.get(key).formations.push(f)
    }
    const list = [...map.values()]
    for (const g of list) {
      g.count      = g.formations.length
      g.lastDate   = g.formations.reduce((max, f) => (!max || new Date(f.date) > new Date(max)) ? f.date : max, null)
      g.pending    = g.formations.filter(f => !f.attestationDelivered).length
      g.docsCount  = g.formations.reduce((n, f) => n + (f.documents?.length || 0), 0)
    }
    return list.sort((a, b) => a.clientName.localeCompare(b.clientName, 'fr'))
  }, [formations])

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.clientName.toLowerCase().includes(q))
  }, [groups, search])

  const openGroup = openClient ? groups.find(g => g.key === openClient) : null
  const detail    = formations.find(f => f._id === detailId)

  const totalPending = groups.reduce((n, g) => n + g.pending, 0)

  if (loading) {
    return (
      <div className="page-content">
        <div className="table-loading"><span className="spinner" /></div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title"><GraduationCap size={20} /> Formations</h1>
          <p className="page-subtitle">
            {formations.length} formation{formations.length !== 1 ? 's' : ''} · {groups.length} client{groups.length !== 1 ? 's' : ''}
            {totalPending > 0 && ` · ${totalPending} attestation${totalPending !== 1 ? 's' : ''} en attente`}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setPickerOpen(true)}>
          <Plus size={14} /> Nouvelle formation
        </button>
      </div>

      {/* Recherche */}
      <div className="fmn-search-bar">
        <Search size={13} className="search-icon" />
        <input
          className="search-input"
          placeholder="Rechercher un client…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="search-clear" onClick={() => setSearch('')}><X size={12} /></button>}
      </div>

      {groups.length === 0 ? (
        <div className="cd-tab-empty">
          <GraduationCap size={40} color="var(--gray-300)" />
          <p>Aucune formation enregistrée.</p>
          <button className="btn btn--primary btn--sm" onClick={() => setPickerOpen(true)}>
            <Plus size={13} /> Créer la première formation
          </button>
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="cd-tab-empty">
          <Search size={40} color="var(--gray-300)" />
          <p>Aucun client ne correspond à « {search} ».</p>
        </div>
      ) : (
        <div className="fmn-client-grid">
          {visibleGroups.map(g => (
            <button key={g.key} className="fmn-client-card" onClick={() => setOpenClient(g.key)}>
              <div className="fmn-client-card-top">
                <div className="fmn-client-avatar">{initials(g.clientName)}</div>
                <div className="fmn-client-card-id">
                  <span className="fmn-client-card-name" title={g.clientName}>{g.clientName}</span>
                  <span className="fmn-client-card-sub">
                    <GraduationCap size={11} /> {g.count} formation{g.count !== 1 ? 's' : ''}
                    {g.docsCount > 0 && <> · <FileText size={11} /> {g.docsCount} doc{g.docsCount !== 1 ? 's' : ''}</>}
                  </span>
                </div>
              </div>

              <div className="fmn-client-card-bottom">
                <span className="fmn-client-card-date">
                  <Clock size={11} /> Dernière : {fmtShort(g.lastDate)}
                </span>
                {g.pending > 0 ? (
                  <span className="fmn-chip fmn-chip--warn">
                    {g.pending} attestation{g.pending !== 1 ? 's' : ''} en attente
                  </span>
                ) : (
                  <span className="fmn-chip fmn-chip--done">
                    <Check size={10} strokeWidth={3} /> À jour
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal formations d'un client */}
      {openGroup && (
        <ClientFormationsModal
          group={openGroup}
          onClose={() => setOpenClient(null)}
          onToggleAttestation={handleToggleAttestation}
          onDelete={handleDelete}
          onOpenDetail={setDetailId}
          onCreate={() => setCreatingFor({ id: openGroup.clientId, name: openGroup.clientName })}
        />
      )}

      {/* Choix du client pour une nouvelle formation */}
      {pickerOpen && (
        <ClientPickerModal
          onClose={() => setPickerOpen(false)}
          onSelect={c => { setPickerOpen(false); setCreatingFor({ id: c._id, name: c.name }) }}
        />
      )}

      {creatingFor && (
        <EventModal
          mode="create"
          entityKind="formation"
          lockType="formation"
          presetClient={creatingFor.id ? { id: creatingFor.id, name: creatingFor.name } : null}
          users={users}
          onClose={() => setCreatingFor(null)}
          onSaved={handleCreated}
        />
      )}

      {detail && (
        <EventModal
          mode="edit"
          entity={detail}
          entityKind="formation"
          lockType="formation"
          users={users}
          onClose={() => setDetailId(null)}
          onSaved={f => { update(f); setDetailId(null) }}
          onChanged={update}
          onDeleted={id => { setFormations(prev => prev.filter(f => f._id !== id)); setDetailId(null) }}
        />
      )}
    </div>
  )
}
