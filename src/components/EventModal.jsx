import { useState, useRef } from 'react'
import { toast } from 'react-toastify'
import {
  Calendar, X, AlertTriangle, Trash2, Upload,
  CheckCircle2, Circle, History, User, Clock,
} from 'lucide-react'
import { createAppointment, updateAppointment, deleteAppointment } from '../api/appointments'
import {
  createFormation, updateFormation, deleteFormation,
  addDocuments, removeDocument, toggleAttestation, STATIC_BASE,
} from '../api/formations'
import { ClientSearchInput, AssignedToInput } from './PlanningInputs'
import {
  STATUS_OPTS, MODAL_TYPE_OPTS, TYPE_MAP,
  localDateStr, localTimeStr, durationOptionsWith,
} from '../lib/appointmentConstants'

/* ── Helpers locaux ─────────────────────────────────────────── */

function fmtShort(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
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

/**
 * Modal unifiée pour créer / éditer un rendez-vous OU une formation.
 * Une formation (type « formation ») ajoute : documents, attestations, historique.
 *
 * @param mode          'create' | 'edit'
 * @param entity        (edit) rendez-vous ou formation brut
 * @param entityKind    (edit) 'appointment' | 'formation'
 * @param slot          (create) créneau FullCalendar { startStr, endStr, allDay }
 * @param presetClient  { id, name } client pré-rempli
 * @param presetType    (create) type initial
 * @param lockType      'formation' → force le type formation (page/onglet Formations)
 * @param onSaved       (obj|null) après création / enregistrement des champs → ferme
 * @param onDeleted     (id) après suppression
 * @param onChanged     (formation) après maj live (attestation, documents) → garde ouvert
 */
export default function EventModal({
  mode, entity, entityKind, slot, presetClient, presetType, lockType,
  users = [], onClose, onSaved, onDeleted, onChanged,
}) {
  const isEdit = mode === 'edit'
  const raw    = entity || {}

  // Formation « verrouillée » : contexte Formations, ou édition d'une formation existante.
  const formationLocked = lockType === 'formation' || (isEdit && entityKind === 'formation')

  // Source de départ de la date (formation = champ `date`, rendez-vous = `start`).
  const startSrc = isEdit
    ? (entityKind === 'formation' ? raw.date : raw.start)
    : (slot?.startStr || new Date().toISOString())

  const initTime = (() => {
    if (isEdit && !raw.allDay && startSrc) return localTimeStr(startSrc)
    if (slot?.startStr && !slot.allDay)     return localTimeStr(slot.startStr)
    return '08:00'
  })()

  const initDuration = (() => {
    const s = startSrc
    const e = isEdit ? raw.end : slot?.endStr
    if (s && e && !slot?.allDay) {
      const m = Math.round((new Date(e) - new Date(s)) / 60000)
      if (m > 0) return m
    }
    return 60
  })()

  const initType = formationLocked ? 'formation'
    : isEdit ? (raw.type || 'autre')
    : (presetType || 'autre')

  const initAssigned = (raw.assignedTo || []).map(a => {
    if (a && typeof a === 'object') return { _id: a._id, fullName: a.fullName || a.username }
    return users.find(u => u._id === a)
  }).filter(Boolean)

  const [form, setForm] = useState({
    title:       isEdit ? (raw.title || '') : '',
    type:        initType,
    status:      isEdit ? (raw.status || 'planifie') : 'planifie',
    date:        localDateStr(startSrc),
    time:        initTime,
    duration:    initDuration,
    clientId:    isEdit ? (raw.client?._id || raw.client || null) : (presetClient?.id || null),
    clientName:  isEdit ? (raw.clientName || raw.client?.name || '') : (presetClient?.name || ''),
    assignedTo:  initAssigned,
    description: isEdit ? (raw.description || '') : '',
  })

  // État live de la formation (documents / attestation / historique) en édition.
  const [fdata,     setFdata]     = useState(entityKind === 'formation' ? raw : null)
  const [files,     setFiles]     = useState([])   // documents en attente (création)
  const [uploading, setUploading] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const fileRef = useRef(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const isFormation = formationLocked || form.type === 'formation'

  const typeChoices = (() => {
    if (formationLocked) return []
    // En édition d'un rendez-vous, on ne permet pas de le transformer en formation.
    let base = (isEdit && entityKind === 'appointment')
      ? MODAL_TYPE_OPTS.filter(t => t.value !== 'formation')
      : MODAL_TYPE_OPTS
    if (!base.some(t => t.value === form.type)) base = [...base, TYPE_MAP[form.type]].filter(Boolean)
    return base
  })()

  const durationOptions = durationOptionsWith(form.duration)
  const typeColor = TYPE_MAP[form.type]?.color || '#6b7280'

  /* ── Documents en création (staging) ──────────────────────── */
  function handleStageFiles(e) {
    setFiles(prev => [...prev, ...Array.from(e.target.files)])
    e.target.value = ''
  }
  function removeStaged(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)) }

  /* ── Documents live (édition formation) ───────────────────── */
  async function handleAddDocsLive(fileList) {
    if (!fileList.length) return
    const fd = new FormData()
    for (const f of fileList) fd.append('documents', f)
    setUploading(true)
    try {
      const updated = await addDocuments(fdata._id, fd)
      setFdata(updated)
      onChanged?.(updated)
      toast.success(`${fileList.length} document${fileList.length > 1 ? 's' : ''} ajouté${fileList.length > 1 ? 's' : ''}.`)
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'ajout.")
    } finally { setUploading(false) }
  }

  async function handleRemoveDoc(docId, name) {
    if (!window.confirm(`Supprimer le document "${name}" ?`)) return
    try {
      const updated = await removeDocument(fdata._id, docId)
      setFdata(updated)
      onChanged?.(updated)
      toast.success('Document supprimé.')
    } catch { toast.error('Erreur lors de la suppression.') }
  }

  async function handleToggleAttestation() {
    try {
      const updated = await toggleAttestation(fdata._id)
      setFdata(updated)
      onChanged?.(updated)
    } catch { toast.error("Erreur lors de la mise à jour de l'attestation.") }
  }

  /* ── Enregistrement ───────────────────────────────────────── */
  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Le titre est requis.')
    if (!form.date)         return setError('La date est requise.')
    const start = new Date(`${form.date}T${form.time || '08:00'}`)
    if (isNaN(start.getTime())) return setError('Date ou heure invalide.')
    const end = new Date(start.getTime() + (Number(form.duration) || 60) * 60000)

    if (isFormation && !form.clientId) {
      return setError('Un client est requis pour une formation.')
    }

    setLoading(true)
    setError('')
    try {
      if (isFormation) {
        if (isEdit) {
          const updated = await updateFormation(raw._id, {
            title:       form.title.trim(),
            date:        start.toISOString(),
            end:         end.toISOString(),
            status:      form.status,
            description: form.description || '',
            client:      form.clientId,
            clientName:  form.clientName || '',
            assignedTo:  form.assignedTo.map(u => u._id),
          })
          toast.success('Formation mise à jour.')
          onSaved?.(updated)
        } else {
          const fd = new FormData()
          fd.append('client',      form.clientId)
          fd.append('clientName',  form.clientName || '')
          fd.append('title',       form.title.trim())
          fd.append('date',        start.toISOString())
          fd.append('end',         end.toISOString())
          fd.append('status',      form.status)
          fd.append('description', form.description || '')
          form.assignedTo.forEach(u => fd.append('assignedTo', u._id))
          files.forEach(f => fd.append('documents', f))
          const created = await createFormation(fd)
          toast.success('Formation créée.')
          onSaved?.(created)
        }
      } else {
        const payload = {
          title:       form.title.trim(),
          type:        form.type,
          status:      form.status,
          allDay:      false,
          start:       start.toISOString(),
          end:         end.toISOString(),
          client:      form.clientId   || undefined,
          clientName:  form.clientName || undefined,
          assignedTo:  form.assignedTo.map(u => u._id),
          description: form.description || undefined,
        }
        let saved
        if (isEdit) { saved = await updateAppointment(raw._id, payload); toast.success('Rendez-vous mis à jour.') }
        else        { saved = await createAppointment(payload);          toast.success('Rendez-vous créé.') }
        onSaved?.(saved)
      }
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    const isFormationEntity = entityKind === 'formation'
    const label = isFormationEntity ? 'cette formation' : 'ce rendez-vous'
    if (!window.confirm(`Supprimer ${label} ?${isFormationEntity ? ' Les documents joints seront supprimés.' : ''}`)) return
    try {
      if (isFormationEntity) await deleteFormation(raw._id)
      else                   await deleteAppointment(raw._id)
      toast.success('Supprimé.')
      onDeleted?.(raw._id)
    } catch (err) {
      toast.error(err.message || 'Erreur.')
    }
  }

  const headerTitle = isEdit
    ? (isFormation ? 'Modifier la formation' : 'Modifier le rendez-vous')
    : (formationLocked ? 'Nouvelle formation' : 'Nouveau rendez-vous')

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pmodal-header-icon" style={{ background: typeColor }}>
              <Calendar size={15} color="#fff" />
            </div>
            <h2 className="modal-title">{headerTitle}</h2>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div className="form-group">
            <label className="form-label">Titre *</label>
            <input className="form-input form-input--plain" value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="ex. Formation gestes qui sauvent" required />
          </div>

          <div className="form-row">
            {!formationLocked && (
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input form-input--plain" value={form.type}
                  onChange={e => set('type', e.target.value)}>
                  {typeChoices.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Statut</label>
              <select className="form-input form-input--plain" value={form.status}
                onChange={e => set('status', e.target.value)}>
                {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input className="form-input form-input--plain" type="date"
                value={form.date} onChange={e => set('date', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Heure *</label>
              <input className="form-input form-input--plain" type="time"
                value={form.time} onChange={e => set('time', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Durée</label>
              <select className="form-input form-input--plain" value={form.duration}
                onChange={e => set('duration', Number(e.target.value))}>
                {durationOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Client{isFormation ? ' *' : ''}</label>
            <ClientSearchInput
              clientId={form.clientId}
              clientName={form.clientName}
              onChange={sel => setForm(f => ({
                ...f,
                clientId:   sel ? sel.id   : null,
                clientName: sel ? sel.name : '',
              }))}
            />
          </div>

          {users.length > 0 && (
            <div className="form-group">
              <label className="form-label">Intervenants</label>
              <AssignedToInput
                selected={form.assignedTo}
                onChange={v => set('assignedTo', v)}
                users={users}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-input--plain form-textarea"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Informations complémentaires…" rows={3} />
          </div>

          {/* ── Section spécifique formation ── */}
          {isFormation && (
            <>
              {/* Attestations (édition uniquement) */}
              {isEdit && fdata && (
                <div className="fmn-detail-section">
                  <span className="fmn-detail-section-label">Attestations</span>
                  <button
                    type="button"
                    className={`fmn-attest-banner ${fdata.attestationDelivered ? 'fmn-attest-banner--done' : 'fmn-attest-banner--pending'}`}
                    onClick={handleToggleAttestation}
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none' }}
                    title={fdata.attestationDelivered ? 'Retirer la livraison' : 'Marquer comme livrées'}
                  >
                    {fdata.attestationDelivered ? (
                      <>
                        <CheckCircle2 size={15} />
                        <div>
                          <strong>Livrées</strong>
                          <span style={{ marginLeft: 6, fontSize: 11 }}>
                            par {fdata.attestationDeliveredBy?.fullName || '—'} le {fmtShort(fdata.attestationDeliveredAt)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Circle size={15} />
                        <strong>En attente de livraison</strong>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Documents */}
              <div className="fmn-detail-section">
                <div className="fmn-detail-section-header">
                  <span className="fmn-detail-section-label">
                    Documents ({isEdit ? (fdata?.documents.length || 0) : files.length})
                  </span>
                  <label className="fmn-add-doc-btn" style={{ cursor: 'pointer' }} title="Ajouter des documents">
                    {uploading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Upload size={12} />}
                    Ajouter
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => {
                        if (isEdit) { handleAddDocsLive(Array.from(e.target.files)); e.target.value = '' }
                        else handleStageFiles(e)
                      }}
                    />
                  </label>
                </div>

                {/* Liste — édition : documents enregistrés */}
                {isEdit ? (
                  (fdata?.documents.length || 0) === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Aucun document joint.</p>
                  ) : (
                    <div className="fmn-doc-list">
                      {fdata.documents.map(doc => (
                        <div key={doc._id} className="fmn-doc-row">
                          <a href={`${STATIC_BASE}/uploads/${doc.path}`} target="_blank" rel="noopener noreferrer" className="fmn-doc-link">
                            <span className="fmn-doc-icon">{fileIcon(doc.originalName)}</span>
                            <span className="fmn-doc-name">{doc.originalName || 'Document'}</span>
                          </a>
                          <div className="fmn-doc-meta">
                            <span>{doc.uploadedBy?.fullName || '—'} · {fmtShort(doc.uploadedAt)}</span>
                            <button type="button" className="fmn-icon-btn fmn-icon-btn--delete" style={{ width: 22, height: 22 }}
                              onClick={() => handleRemoveDoc(doc._id, doc.originalName)} title="Supprimer ce document">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  /* Création : fichiers en attente d'upload */
                  files.length === 0 ? (
                    <label className="fmn-upload-drop">
                      <Upload size={20} color="var(--gray-300)" />
                      <span>Glissez des fichiers ou cliquez pour parcourir</span>
                      <input type="file" multiple style={{ display: 'none' }} onChange={handleStageFiles} />
                    </label>
                  ) : (
                    <div className="fmn-file-list">
                      {files.map((f, i) => (
                        <div key={i} className="fmn-file-row">
                          <span className="fmn-doc-icon">{fileIcon(f.name)}</span>
                          <span className="fmn-file-name">{f.name}</span>
                          <button type="button" className="fmn-icon-btn fmn-icon-btn--delete" style={{ width: 22, height: 22 }} onClick={() => removeStaged(i)}>
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Historique (édition uniquement) */}
              {isEdit && fdata?.history?.length > 0 && (
                <details className="fmn-detail-section">
                  <summary className="fmn-detail-section-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <History size={12} /> Opérations ({fdata.history.length})
                  </summary>
                  <div className="fmn-history" style={{ marginTop: 8 }}>
                    {[...fdata.history].reverse().map((h, i) => (
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
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer" style={{ paddingTop: 0 }}>
            {isEdit && (
              <button type="button" className="btn btn--danger-ghost" onClick={handleDelete}>
                <Trash2 size={14} /> Supprimer
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
