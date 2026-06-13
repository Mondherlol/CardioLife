import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import {
  GraduationCap, Plus, FileText, User, Calendar,
  Trash2, Check, X, Upload, Clock, History,
  CheckCircle2, Circle,
} from 'lucide-react'
import {
  getFormationsByClient, createFormation, deleteFormation,
  toggleAttestation, addDocuments, removeDocument, STATIC_BASE,
} from '../api/formations'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtShort(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  if (ext === 'pdf') return '📄'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx'].includes(ext)) return '📊'
  return '📎'
}

/* ─── Main tab ──────────────────────────────────────────────── */
export default function FormationsClientTab({ clientId, clientName }) {
  const [formations, setFormations] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId,   setDetailId]   = useState(null)

  useEffect(() => {
    getFormationsByClient(clientId)
      .then(data => { setFormations(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId])

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
    e.stopPropagation()
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
    setCreateOpen(false)
    setDetailId(f._id)
    toast.success('Formation créée.')
  }

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  const detail = formations.find(f => f._id === detailId)

  return (
    <div className="fmn-tab">
      <div className="fmn-tab-bar">
        <span className="fmn-tab-count">
          {formations.length} formation{formations.length !== 1 ? 's' : ''}
        </span>
        <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> Nouvelle formation
        </button>
      </div>

      {formations.length === 0 ? (
        <div className="cd-tab-empty">
          <GraduationCap size={40} color="var(--gray-300)" />
          <p>Aucune formation enregistrée pour ce client.</p>
        </div>
      ) : (
        <div className="fmn-list">
          {formations.map(f => (
            <div
              key={f._id}
              className={`fmn-card ${f.attestationDelivered ? 'fmn-card--done' : ''}`}
              onClick={() => setDetailId(f._id)}
            >
              {/* Attestation toggle — stopPropagation pour ne pas ouvrir la modal */}
              <button
                className={`fmn-attest-btn ${f.attestationDelivered ? 'fmn-attest-btn--done' : ''}`}
                onClick={e => { e.stopPropagation(); handleToggleAttestation(f._id) }}
                title={f.attestationDelivered ? 'Retirer la livraison des attestations' : 'Marquer les attestations comme livrées'}
              >
                {f.attestationDelivered
                  ? <CheckCircle2 size={18} />
                  : <Circle size={18} />}
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
                  onClick={e => { e.stopPropagation(); setDetailId(f._id) }}
                  title="Voir les détails / historique"
                >
                  <History size={14} />
                </button>
                <button
                  className="fmn-icon-btn fmn-icon-btn--delete"
                  onClick={e => handleDelete(f._id, e)}
                  title="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateFormationModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {detail && (
        <FormationDetailModal
          formation={detail}
          onClose={() => setDetailId(null)}
          onUpdated={update}
        />
      )}
    </div>
  )
}

/* ─── Detail modal ──────────────────────────────────────────── */
function FormationDetailModal({ formation: f, onClose, onUpdated }) {
  const [tab,        setTab]        = useState('details')
  const [uploading,  setUploading]  = useState(false)
  const fileRef = useRef()

  async function handleAddDocs(files) {
    if (!files.length) return
    const fd = new FormData()
    for (const file of files) fd.append('documents', file)
    setUploading(true)
    try {
      const updated = await addDocuments(f._id, fd)
      onUpdated(updated)
      toast.success(`${files.length} document${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''}.`)
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'ajout.")
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveDoc(docId, name) {
    if (!window.confirm(`Supprimer le document "${name}" ?`)) return
    try {
      const updated = await removeDocument(f._id, docId)
      onUpdated(updated)
      toast.success('Document supprimé.')
    } catch { toast.error('Erreur lors de la suppression.') }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal--md">

        <div className="modal-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="modal-title">{f.title}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
              {fmtDate(f.date)}
            </span>
          </div>
          <button className="modal-close" type="button" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Onglets */}
        <div className="fmn-modal-tabs">
          <button
            className={`fmn-modal-tab ${tab === 'details' ? 'fmn-modal-tab--active' : ''}`}
            onClick={() => setTab('details')}
          >
            Détails
          </button>
          <button
            className={`fmn-modal-tab ${tab === 'history' ? 'fmn-modal-tab--active' : ''}`}
            onClick={() => setTab('history')}
          >
            <History size={12} /> Opérations
            <span className="fmn-modal-tab-badge">{f.history.length}</span>
          </button>
        </div>

        <div className="modal-body" style={{ gap: 16 }}>

          {/* ── Onglet Détails ── */}
          {tab === 'details' && (
            <>
              {f.description && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{f.description}</p>
              )}

              {/* Attestation */}
              <div className="fmn-detail-section">
                <span className="fmn-detail-section-label">Attestations</span>
                <div className={`fmn-attest-banner ${f.attestationDelivered ? 'fmn-attest-banner--done' : 'fmn-attest-banner--pending'}`}>
                  {f.attestationDelivered ? (
                    <>
                      <CheckCircle2 size={15} />
                      <div>
                        <strong>Livrées</strong>
                        <span style={{ marginLeft: 6, fontSize: 11 }}>
                          par {f.attestationDeliveredBy?.fullName || '—'} le {fmtShort(f.attestationDeliveredAt)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <Circle size={15} />
                      <strong>En attente de livraison</strong>
                    </>
                  )}
                </div>
              </div>

              {/* Documents */}
              <div className="fmn-detail-section">
                <div className="fmn-detail-section-header">
                  <span className="fmn-detail-section-label">Documents ({f.documents.length})</span>
                  <label className="fmn-add-doc-btn" title="Ajouter des documents">
                    {uploading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Upload size={12} />}
                    Ajouter
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => { handleAddDocs(Array.from(e.target.files)); e.target.value = '' }}
                    />
                  </label>
                </div>

                {f.documents.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Aucun document joint.</p>
                ) : (
                  <div className="fmn-doc-list">
                    {f.documents.map(doc => (
                      <div key={doc._id} className="fmn-doc-row">
                        <a
                          href={`${STATIC_BASE}/uploads/${doc.path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="fmn-doc-link"
                        >
                          <span className="fmn-doc-icon">{fileIcon(doc.originalName)}</span>
                          <span className="fmn-doc-name">{doc.originalName || 'Document'}</span>
                        </a>
                        <div className="fmn-doc-meta">
                          <span>{doc.uploadedBy?.fullName || '—'} · {fmtShort(doc.uploadedAt)}</span>
                          <button
                            className="fmn-icon-btn fmn-icon-btn--delete"
                            style={{ width: 22, height: 22 }}
                            onClick={() => handleRemoveDoc(doc._id, doc.originalName)}
                            title="Supprimer ce document"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Création */}
              <div className="fmn-meta" style={{ marginTop: 4 }}>
                <span className="fmn-meta-item">
                  <User size={11} />
                  Créée par <strong>{f.createdBy?.fullName || '—'}</strong> le {fmtShort(f.createdAt)}
                </span>
              </div>
            </>
          )}

          {/* ── Onglet Opérations ── */}
          {tab === 'history' && (
            <div className="fmn-history">
              {f.history.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aucune opération enregistrée.</p>
              ) : (
                [...f.history].reverse().map((h, i) => (
                  <div key={i} className="fmn-history-row">
                    <div className="fmn-history-dot" />
                    <div className="fmn-history-content">
                      <span className="fmn-history-action">{h.action}</span>
                      {h.details && <span className="fmn-history-details">{h.details}</span>}
                      <span className="fmn-history-meta">
                        <User size={10} /> {h.by?.fullName || '—'}
                        <Clock size={10} style={{ marginLeft: 6 }} /> {fmtDateTime(h.at)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Create modal ──────────────────────────────────────────── */
function CreateFormationModal({ clientId, clientName, onClose, onCreated }) {
  const [title,       setTitle]       = useState('')
  const [date,        setDate]        = useState('')
  const [description, setDescription] = useState('')
  const [files,       setFiles]       = useState([])
  const [saving,      setSaving]      = useState(false)

  function handleFiles(e) {
    setFiles(prev => [...prev, ...Array.from(e.target.files)])
    e.target.value = ''
  }
  function removeFile(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !date) return

    const fd = new FormData()
    fd.append('client',      clientId)
    fd.append('clientName',  clientName || '')
    fd.append('title',       title.trim())
    fd.append('date',        date)
    fd.append('description', description.trim())
    files.forEach(f => fd.append('documents', f))

    setSaving(true)
    try {
      const created = await createFormation(fd)
      onCreated(created)
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la création.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal--md">
        <div className="modal-header">
          <span className="modal-title">Nouvelle formation</span>
          <button className="modal-close" type="button" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          <div className="modal-body">

            <div className="form-group">
              <label className="form-label">Titre *</label>
              <input
                className="form-input"
                style={{ paddingLeft: 14 }}
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder="Ex : Formation gestes qui sauvent"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Date *</label>
              <input
                className="form-input"
                style={{ paddingLeft: 14 }}
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                style={{ paddingLeft: 14, resize: 'vertical', minHeight: 64 }}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Détails optionnels…"
              />
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">Documents ({files.length})</label>
                <label className="add-field-btn" style={{ cursor: 'pointer' }}>
                  <Plus size={11} /> Ajouter
                  <input type="file" multiple style={{ display: 'none' }} onChange={handleFiles} />
                </label>
              </div>

              {files.length === 0 ? (
                <label className="fmn-upload-drop">
                  <Upload size={20} color="var(--gray-300)" />
                  <span>Glissez des fichiers ou cliquez pour parcourir</span>
                  <input type="file" multiple style={{ display: 'none' }} onChange={handleFiles} />
                </label>
              ) : (
                <div className="fmn-file-list">
                  {files.map((f, i) => (
                    <div key={i} className="fmn-file-row">
                      <span className="fmn-doc-icon">{fileIcon(f.name)}</span>
                      <span className="fmn-file-name">{f.name}</span>
                      <button type="button" className="fmn-icon-btn fmn-icon-btn--delete" style={{ width: 22, height: 22 }} onClick={() => removeFile(i)}>
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <label className="fmn-add-doc-btn" style={{ marginTop: 4, cursor: 'pointer' }}>
                    <Upload size={12} /> Ajouter d'autres fichiers
                    <input type="file" multiple style={{ display: 'none' }} onChange={handleFiles} />
                  </label>
                </div>
              )}
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Créer la formation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
