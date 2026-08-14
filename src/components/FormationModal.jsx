import { useState, useEffect, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import {
  GraduationCap, X, AlertTriangle, Trash2, Upload, FileText, Users,
  UserPlus, Check, Clock, History, User, Mail, Phone, Building2,
  CalendarDays, Copy, Send, CircleDashed, CheckCircle2, Ban,
} from 'lucide-react'
import {
  createFormation, updateFormation, deleteFormation,
  addDocuments, removeDocument, STATIC_BASE,
} from '../api/formations'
import { getSites } from '../api/sites'
import { ClientSearchInput, AssignedToInput } from './PlanningInputs'
import { localDateStr, localTimeStr, durationOptionsWith } from '../lib/appointmentConstants'
import {
  STAGE_LIST, stageOf, stagePayload, PARTICIPANT_LIST, participantState,
  countParticipants, seatsUsed, attestationRecipient,
} from '../lib/formations'

const STAGE_ICONS = {
  programme: CalendarDays,
  termine:   CheckCircle2,
  livre:     Send,
  annule:    Ban,
}
const PARTICIPANT_ICONS = { a_former: CircleDashed, forme: CheckCircle2, absent: Ban }

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
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
const emptyParticipant = () => ({ name: '', role: '', email: '', phone: '', status: 'a_former' })

/* ── Destinataire des attestations ───────────────────────────── */

/**
 * À qui partent les attestations. Le responsable du site est proposé d'un clic :
 * c'est lui dans la quasi-totalité des cas, et le retaper à la main était la
 * première source d'erreur d'envoi.
 */
function RecipientBlock({ contact, siteContacts, onChange }) {
  const [manual, setManual] = useState(false)
  const filled = contact.name || contact.email || contact.phone

  function copy(value, label) {
    navigator.clipboard?.writeText(value)
      .then(() => toast.success(`${label} copié.`))
      .catch(() => {})
  }

  return (
    <div className="fm-block">
      <div className="fm-block-head">
        <span className="fm-block-title"><Send size={13} /> Destinataire des attestations</span>
        {filled && (
          <button type="button" className="fm-linkbtn" onClick={() => { onChange({}); setManual(false) }}>
            Effacer
          </button>
        )}
      </div>

      {siteContacts.length > 0 && (
        <div className="fm-contact-picks">
          {siteContacts.map((c, i) => {
            const on = filled && c.email
              ? c.email === contact.email
              : filled && c.name === contact.name
            return (
              <button key={i} type="button"
                className={`fm-contact-pick${on ? ' fm-contact-pick--on' : ''}`}
                onClick={() => { onChange({ name: c.name, role: c.role, email: c.email, phone: c.phone }); setManual(false) }}>
                <span className="fm-contact-pick-name">{c.name || 'Sans nom'}</span>
                {c.role && <span className="fm-contact-pick-role">{c.role}</span>}
                {on && <Check size={12} className="fm-contact-pick-check" />}
              </button>
            )
          })}
          <button type="button"
            className={`fm-contact-pick fm-contact-pick--manual${manual ? ' fm-contact-pick--on' : ''}`}
            onClick={() => setManual(m => !m)}>
            <UserPlus size={12} /> Autre personne
          </button>
        </div>
      )}

      {(manual || siteContacts.length === 0) ? (
        <div className="fm-contact-form">
          <input className="form-input form-input--plain" placeholder="Nom du responsable"
            value={contact.name || ''} onChange={e => onChange({ ...contact, name: e.target.value })} />
          <input className="form-input form-input--plain" placeholder="Fonction"
            value={contact.role || ''} onChange={e => onChange({ ...contact, role: e.target.value })} />
          <input className="form-input form-input--plain" type="email" placeholder="email@exemple.tn"
            value={contact.email || ''} onChange={e => onChange({ ...contact, email: e.target.value })} />
          <input className="form-input form-input--plain" placeholder="Téléphone"
            value={contact.phone || ''} onChange={e => onChange({ ...contact, phone: e.target.value })} />
        </div>
      ) : filled ? (
        <div className="fm-contact-card">
          <div className="fm-contact-card-id">
            <span className="fm-contact-card-name">{contact.name || 'Responsable du site'}</span>
            {contact.role && <span className="fm-contact-card-role">{contact.role}</span>}
          </div>
          <div className="fm-contact-card-lines">
            {contact.email && (
              <span className="fm-contact-line">
                <Mail size={12} />
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
                <button type="button" className="fm-copy" title="Copier l'adresse"
                  onClick={() => copy(contact.email, 'Email')}><Copy size={11} /></button>
              </span>
            )}
            {contact.phone && (
              <span className="fm-contact-line">
                <Phone size={12} />
                <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                <button type="button" className="fm-copy" title="Copier le numéro"
                  onClick={() => copy(contact.phone, 'Numéro')}><Copy size={11} /></button>
              </span>
            )}
            {!contact.email && (
              <span className="fm-contact-line fm-contact-line--warn">
                <AlertTriangle size={12} /> Pas d'email : les attestations ne pourront pas être envoyées.
              </span>
            )}
          </div>
          <button type="button" className="fm-linkbtn" onClick={() => setManual(true)}>Modifier</button>
        </div>
      ) : (
        <p className="fm-hint">
          Choisissez le responsable à qui envoyer les attestations préparées.
        </p>
      )}
    </div>
  )
}

/* ── Liste nominative des agents ─────────────────────────────── */

function ParticipantsBlock({ participants, onChange, quotaLine }) {
  const [draft, setDraft] = useState(emptyParticipant())
  const counts = countParticipants({ participants })

  function add() {
    if (!draft.name.trim()) return
    onChange([...participants, { ...draft, name: draft.name.trim() }])
    setDraft(emptyParticipant())
  }

  function setAt(i, patch) {
    onChange(participants.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  function removeAt(i) {
    onChange(participants.filter((_, idx) => idx !== i))
  }

  /* Cycle À former → Formé → Absent : un clic sur la pastille suffit à
     pointer la séance, sans ouvrir de menu. */
  function cycle(i) {
    const order = ['a_former', 'forme', 'absent']
    const cur   = participants[i].status || 'a_former'
    setAt(i, { status: order[(order.indexOf(cur) + 1) % order.length] })
  }

  return (
    <div className="fm-block">
      <div className="fm-block-head">
        <span className="fm-block-title"><Users size={13} /> Agents à former ({participants.length})</span>
        {participants.length > 0 && (
          <span className="fm-block-counts">
            <span className="fm-dot fm-dot--green" /> {counts.forme} formé{counts.forme > 1 ? 's' : ''}
            <span className="fm-dot fm-dot--amber" /> {counts.a_former} à former
            {counts.absent > 0 && <><span className="fm-dot fm-dot--muted" /> {counts.absent} absent{counts.absent > 1 ? 's' : ''}</>}
          </span>
        )}
      </div>

      {participants.length > 0 && (
        <div className="fm-people">
          {participants.map((p, i) => {
            const st   = participantState(p)
            const Icon = PARTICIPANT_ICONS[st.id]
            return (
              <div key={i} className={`fm-person fm-person--${st.id}`}>
                <button type="button" className={`fm-person-state fm-person-state--${st.id}`}
                  onClick={() => cycle(i)} title="Changer l'état (à former → formé → absent)">
                  <Icon size={14} />
                </button>

                <div className="fm-person-fields">
                  <input className="fm-person-name" value={p.name} placeholder="Nom de l'agent"
                    onChange={e => setAt(i, { name: e.target.value })} />
                  <input className="fm-person-sub" value={p.role || ''} placeholder="Fonction"
                    onChange={e => setAt(i, { role: e.target.value })} />
                  <input className="fm-person-sub" value={p.email || ''} placeholder="Email (attestation)"
                    onChange={e => setAt(i, { email: e.target.value })} />
                </div>

                <span className={`fm-person-badge fm-person-badge--${st.tone}`}>{st.label}</span>
                <button type="button" className="fmn-icon-btn fmn-icon-btn--delete"
                  onClick={() => removeAt(i)} title="Retirer de la liste">
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="fm-person-add">
        <input className="form-input form-input--plain" placeholder="Nom de l'agent à former"
          value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <input className="form-input form-input--plain" placeholder="Fonction"
          value={draft.role}
          onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={add} disabled={!draft.name.trim()}>
          <UserPlus size={13} /> Ajouter
        </button>
      </div>

      <div className="fm-people-foot">
        {participants.length === 0 && (
          <span className="fm-hint">
            Sans liste nominative, seul le nombre de personnes est retenu pour le quota.
          </span>
        )}
        {quotaLine}
      </div>

      {PARTICIPANT_LIST.length > 0 && participants.length > 0 && (
        <div className="fm-people-bulk">
          <span>Tout marquer :</span>
          {PARTICIPANT_LIST.map(s => (
            <button key={s.id} type="button" className="fm-linkbtn"
              onClick={() => onChange(participants.map(p => ({ ...p, status: s.id })))}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Documents ───────────────────────────────────────────────── */

function DocumentsBlock({ isEdit, docs, files, uploading, onPick, onDropFiles, onRemoveDoc, onRemoveFile }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)
  const count = isEdit ? docs.length : files.length

  return (
    <div className="fm-block">
      <div className="fm-block-head">
        <span className="fm-block-title"><FileText size={13} /> Documents ({count})</span>
        <button type="button" className="fm-linkbtn" onClick={() => inputRef.current?.click()}>
          {uploading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Upload size={11} />} Parcourir
        </button>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { onPick(Array.from(e.target.files)); e.target.value = '' }} />
      </div>

      <div
        className={`fm-drop${over ? ' fm-drop--over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault(); setOver(false)
          onDropFiles(Array.from(e.dataTransfer.files || []))
        }}
        onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <Upload size={18} />
        <span>Glissez les supports, feuilles d'émargement ou attestations ici</span>
        <span className="fm-drop-sub">ou cliquez pour parcourir · 20 Mo par fichier</span>
      </div>

      {isEdit && docs.length > 0 && (
        <div className="fm-docs">
          {docs.map(doc => (
            <div key={doc._id} className="fm-doc">
              <span className="fm-doc-icon">{fileIcon(doc.originalName)}</span>
              <a className="fm-doc-name" href={`${STATIC_BASE}/uploads/${doc.path}`}
                target="_blank" rel="noopener noreferrer">
                {doc.originalName || 'Document'}
              </a>
              <span className="fm-doc-meta">{doc.uploadedBy?.fullName || '—'} · {fmtShort(doc.uploadedAt)}</span>
              <button type="button" className="fmn-icon-btn fmn-icon-btn--delete"
                onClick={() => onRemoveDoc(doc._id, doc.originalName)} title="Supprimer">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!isEdit && files.length > 0 && (
        <div className="fm-docs">
          {files.map((f, i) => (
            <div key={i} className="fm-doc">
              <span className="fm-doc-icon">{fileIcon(f.name)}</span>
              <span className="fm-doc-name">{f.name}</span>
              <span className="fm-doc-meta">{humanSize(f.size)}</span>
              <button type="button" className="fmn-icon-btn fmn-icon-btn--delete"
                onClick={() => onRemoveFile(i)} title="Retirer">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Modal ───────────────────────────────────────────────────── */

/**
 * Fiche formation — création et suivi.
 *
 * Une formation se lit de haut en bas comme elle se vit : on cale la séance, on
 * nomme les agents à former, on désigne qui recevra les attestations, on joint
 * les documents. Le bandeau d'étape en tête (Programmé → Terminé → Terminé &
 * livré) est le seul endroit d'où le cycle avance.
 *
 * Props :
 *  mode          'create' | 'edit'
 *  formation     (edit) la formation
 *  presetClient  { id, name }
 *  presetSite    { id, name }
 *  slot          (create) créneau du planning { startStr, endStr }
 *  quota         droit à formation du site — affiche le solde de places
 *  users         intervenants sélectionnables
 *  onSaved / onDeleted / onChanged
 */
export default function FormationModal({
  mode = 'create', formation, presetClient, presetSite, slot, quota,
  users = [], onClose, onSaved, onDeleted, onChanged,
}) {
  const isEdit = mode === 'edit'
  const raw    = formation || {}

  const startSrc = isEdit ? raw.date : (slot?.startStr || new Date().toISOString())
  const initDuration = (() => {
    const e = isEdit ? raw.end : slot?.endStr
    if (startSrc && e) {
      const m = Math.round((new Date(e) - new Date(startSrc)) / 60000)
      if (m > 0) return m
    }
    return 120
  })()

  const [form, setForm] = useState({
    title:       raw.title || '',
    stage:       stageOf(raw).id,
    date:        localDateStr(startSrc),
    time:        isEdit || slot?.startStr ? localTimeStr(startSrc) : '09:00',
    duration:    initDuration,
    clientId:    isEdit ? (raw.client?._id || raw.client || null) : (presetClient?.id || null),
    clientName:  isEdit ? (raw.clientName || raw.client?.name || '') : (presetClient?.name || ''),
    siteId:      isEdit ? (raw.site?._id || raw.site || null) : (presetSite?.id || null),
    siteName:    isEdit ? (raw.siteName || raw.site?.name || '') : (presetSite?.name || ''),
    assignedTo:  (raw.assignedTo || []).map(a =>
      (a && typeof a === 'object') ? { _id: a._id, fullName: a.fullName || a.username } : users.find(u => u._id === a)
    ).filter(Boolean),
    description: raw.description || '',
    participantsCount: raw.participantsCount ?? '',
  })

  const [participants, setParticipants] = useState(raw.participants ? raw.participants.map(p => ({ ...p })) : [])
  const [contact, setContact] = useState(() => {
    const r = attestationRecipient(raw, raw.site)
    return r ? { name: r.name, role: r.role, email: r.email, phone: r.phone } : {}
  })

  const [fdata,     setFdata]     = useState(isEdit ? raw : null)
  const [files,     setFiles]     = useState([])
  const [uploading, setUploading] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  /* Sites du client : le site formé porte le quota et le responsable. */
  const [siteOptions, setSiteOptions] = useState([])
  useEffect(() => {
    if (!form.clientId) { setSiteOptions([]); return }
    let alive = true
    getSites({ client: form.clientId })
      .then(d => { if (alive) setSiteOptions(Array.isArray(d) ? d : []) })
      .catch(() => {})
    return () => { alive = false }
  }, [form.clientId])

  const selectedSite = useMemo(
    () => siteOptions.find(s => s._id === form.siteId) || null,
    [siteOptions, form.siteId])

  const siteContacts = useMemo(() => {
    const list = selectedSite?.contacts || raw.site?.contacts || []
    return list.filter(c => c && (c.name || c.email || c.phone))
  }, [selectedSite, raw.site])

  /* Le responsable du site s'installe de lui-même tant que rien n'a été choisi :
     l'assistante n'a rien à saisir dans le cas courant. */
  useEffect(() => {
    if (contact.name || contact.email || contact.phone) return
    const first = siteContacts[0]
    if (first) setContact({ name: first.name, role: first.role, email: first.email, phone: first.phone })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteContacts])

  /* ── Documents ───────────────────────────────────────────── */
  async function uploadLive(list) {
    if (!list.length) return
    const fd = new FormData()
    list.forEach(f => fd.append('documents', f))
    setUploading(true)
    try {
      const updated = await addDocuments(fdata._id, fd)
      setFdata(updated)
      onChanged?.(updated)
      toast.success(`${list.length} document${list.length > 1 ? 's' : ''} ajouté${list.length > 1 ? 's' : ''}.`)
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'ajout.")
    } finally { setUploading(false) }
  }

  function handlePick(list) {
    if (!list.length) return
    if (isEdit) uploadLive(list)
    else setFiles(prev => [...prev, ...list])
  }

  async function handleRemoveDoc(docId, name) {
    if (!window.confirm(`Supprimer le document « ${name} » ?`)) return
    try {
      const updated = await removeDocument(fdata._id, docId)
      setFdata(updated)
      onChanged?.(updated)
      toast.success('Document supprimé.')
    } catch { toast.error('Erreur lors de la suppression.') }
  }

  /* ── Enregistrement ──────────────────────────────────────── */
  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim())  return setError('Le titre est requis.')
    if (!form.clientId)      return setError('Un client est requis.')
    if (!form.date)          return setError('La date est requise.')

    const start = new Date(`${form.date}T${form.time || '09:00'}`)
    if (isNaN(start.getTime())) return setError('Date ou heure invalide.')
    const end = new Date(start.getTime() + (Number(form.duration) || 120) * 60000)

    const named = participants.filter(p => p.name?.trim())
    if (form.stage === 'livre' && !contact.email) {
      return setError('Indiquez l\'email du destinataire avant de marquer les attestations livrées.')
    }

    const base = {
      ...stagePayload(form.stage),
      title:       form.title.trim(),
      date:        start.toISOString(),
      end:         end.toISOString(),
      description: form.description || '',
      client:      form.clientId,
      clientName:  form.clientName || '',
      site:        form.siteId || '',
      siteName:    form.siteName || '',
      participantsCount: named.length ? named.length : (Number(form.participantsCount) || 0),
    }

    setLoading(true)
    setError('')
    try {
      if (isEdit) {
        const updated = await updateFormation(raw._id, {
          ...base,
          assignedTo:         form.assignedTo.map(u => u._id),
          participants:       named,
          attestationContact: contact,
        })
        toast.success('Formation enregistrée.')
        onSaved?.(updated)
      } else {
        const fd = new FormData()
        Object.entries(base).forEach(([k, v]) => {
          if (k === 'attestationDelivered') fd.append(k, String(v))
          else fd.append(k, v == null ? '' : String(v))
        })
        form.assignedTo.forEach(u => fd.append('assignedTo', u._id))
        fd.append('participants',       JSON.stringify(named))
        fd.append('attestationContact', JSON.stringify(contact))
        files.forEach(f => fd.append('documents', f))
        const created = await createFormation(fd)
        toast.success('Formation programmée.')
        onSaved?.(created)
      }
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Supprimer cette formation ? Les documents joints seront supprimés.')) return
    try {
      await deleteFormation(raw._id)
      toast.success('Formation supprimée.')
      onDeleted?.(raw._id)
    } catch (err) { toast.error(err.message || 'Erreur.') }
  }

  /* Solde de places : les places de cette formation sont déjà comptées dans le
     quota reçu en édition — on les rend avant de retrancher la saisie. */
  const quotaLine = quota ? (() => {
    const own  = isEdit ? seatsUsed(raw) : 0
    const used = participants.filter(p => p.status !== 'absent').length
      || (Number(form.participantsCount) || 0)
    const left = quota.remaining + own - used
    return (
      <span className={`fm-quota${left < 0 ? ' fm-quota--over' : ''}`}>
        <GraduationCap size={11} />
        {left < 0
          ? `Droit du site dépassé de ${Math.abs(left)} place${Math.abs(left) > 1 ? 's' : ''}`
          : `${left} place${left > 1 ? 's' : ''} restantes sur ${quota.credit} (${quota.seatsPerDea} par DAE)`}
      </span>
    )
  })() : null

  const durationOptions = durationOptionsWith(form.duration)
  const docs = fdata?.documents || []

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--lg">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pmodal-header-icon" style={{ background: '#a855f7' }}>
              <GraduationCap size={15} color="#fff" />
            </div>
            <div>
              <h2 className="modal-title">{isEdit ? 'Fiche formation' : 'Nouvelle formation'}</h2>
              {isEdit && (
                <p className="modal-subtitle">
                  {raw.clientName}{(raw.site?.name || raw.siteName) ? ` · ${raw.site?.name || raw.siteName}` : ''}
                </p>
              )}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body fm-body">

          {/* Étape du cycle */}
          <div className="fm-stages">
            {STAGE_LIST.map(s => {
              const Icon = STAGE_ICONS[s.id]
              return (
                <button key={s.id} type="button"
                  className={`fm-stage fm-stage--${s.tone}${form.stage === s.id ? ' fm-stage--on' : ''}`}
                  onClick={() => set('stage', s.id)}>
                  <Icon size={13} /> {s.label}
                </button>
              )
            })}
          </div>
          {form.stage === 'termine' && (
            <p className="fm-stage-hint">
              <AlertTriangle size={11} /> Séance faite — il reste à envoyer les attestations
              {contact.email ? <> à <strong>{contact.email}</strong></> : ' au responsable du site'}.
            </p>
          )}
          {form.stage === 'livre' && fdata?.attestationDeliveredAt && (
            <p className="fm-stage-hint fm-stage-hint--ok">
              <Check size={11} /> Attestations livrées le {fmtShort(fdata.attestationDeliveredAt)}
              {fdata.attestationDeliveredBy?.fullName && ` par ${fdata.attestationDeliveredBy.fullName}`}.
            </p>
          )}

          {/* Séance */}
          <div className="fm-block">
            <div className="fm-block-head">
              <span className="fm-block-title"><CalendarDays size={13} /> Séance</span>
            </div>

            <div className="form-group">
              <label className="form-label">Intitulé *</label>
              <input className="form-input form-input--plain" value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="ex. Formation gestes qui sauvent — utilisation du DAE" required />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input className="form-input form-input--plain" type="date" value={form.date}
                  onChange={e => set('date', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Heure *</label>
                <input className="form-input form-input--plain" type="time" value={form.time}
                  onChange={e => set('time', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Durée</label>
                <select className="form-input form-input--plain" value={form.duration}
                  onChange={e => set('duration', Number(e.target.value))}>
                  {durationOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Client *</label>
                <ClientSearchInput
                  clientId={form.clientId}
                  clientName={form.clientName}
                  onChange={sel => setForm(f => ({
                    ...f,
                    clientId:   sel ? sel.id : null,
                    clientName: sel ? sel.name : '',
                    siteId:     null,
                    siteName:   '',
                  }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Site formé</label>
                <select className="form-input form-input--plain" value={form.siteId || ''}
                  disabled={!form.clientId}
                  onChange={e => {
                    const s = siteOptions.find(o => o._id === e.target.value)
                    setForm(f => ({ ...f, siteId: s?._id || null, siteName: s?.name || '' }))
                    setContact({})
                  }}>
                  <option value="">— Aucun site précis —</option>
                  {siteOptions.map(s => (
                    <option key={s._id} value={s._id}>
                      {s.name}{s.address?.city ? ` · ${s.address.city}` : ''}
                    </option>
                  ))}
                </select>
                {selectedSite && (
                  <p className="fm-hint">
                    <Building2 size={11} /> {selectedSite.deas?.length || 0} DAE sur ce site
                  </p>
                )}
              </div>
            </div>

            {users.length > 0 && (
              <div className="form-group">
                <label className="form-label">Formateurs</label>
                <AssignedToInput selected={form.assignedTo} users={users}
                  onChange={v => set('assignedTo', v)} />
              </div>
            )}
          </div>

          {/* Agents */}
          <ParticipantsBlock
            participants={participants}
            onChange={setParticipants}
            quotaLine={quotaLine}
          />

          {participants.length === 0 && (
            <div className="form-group">
              <label className="form-label">Nombre de personnes formées</label>
              <input className="form-input form-input--plain" type="number" min="0"
                style={{ maxWidth: 160 }}
                value={form.participantsCount}
                onChange={e => set('participantsCount', e.target.value)}
                placeholder="0" />
            </div>
          )}

          {/* Destinataire */}
          <RecipientBlock contact={contact} siteContacts={siteContacts} onChange={setContact} />

          {/* Documents */}
          <DocumentsBlock
            isEdit={isEdit}
            docs={docs}
            files={files}
            uploading={uploading}
            onPick={handlePick}
            onDropFiles={handlePick}
            onRemoveDoc={handleRemoveDoc}
            onRemoveFile={i => setFiles(prev => prev.filter((_, idx) => idx !== i))}
          />

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-input--plain form-textarea" rows={2}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Salle, matériel à prévoir, particularités…" />
          </div>

          {isEdit && fdata?.history?.length > 0 && (
            <details className="fm-block">
              <summary className="fm-block-title" style={{ cursor: 'pointer' }}>
                <History size={13} /> Historique ({fdata.history.length})
              </summary>
              <div className="fmn-history" style={{ marginTop: 10 }}>
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
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Programmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
