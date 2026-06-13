import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, CheckCircle2, Clock, AlertCircle, MapPin, Zap,
  Camera, Trash2, X, Save, ImagePlus, Hash, Navigation,
  Shield, Battery, Radio, Package, StickyNote, Calendar, User,
  ChevronDown, ClipboardList, History, Download,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  getIntervention, saveFiche, closeIntervention,
  uploadFichePhoto, deleteFichePhoto, fichePhotoUrl,
  updateIntervention,
} from '../api/interventions'
import { get, STATIC_BASE } from '../api/http'
import { useLoadingBar } from '../hooks/useLoadingBar'

/* ─── Constants ─── */
const STATUS_META = {
  planifie: { label: 'Planifié',  cls: 'iv-badge iv-badge--blue',   Icon: Clock },
  en_cours: { label: 'En cours',  cls: 'iv-badge iv-badge--orange', Icon: AlertCircle },
  termine:  { label: 'Terminé',   cls: 'iv-badge iv-badge--green',  Icon: CheckCircle2 },
}

const ACTION_LABELS = {
  creation:      'Intervention créée',
  debut:         'Intervention démarrée',
  modification:  'Intervention modifiée',
  rapport_soumis:'Fiche soumise',
  cloture:       'Intervention clôturée',
}

const SIG_PRESETS = ['Complet', 'Incomplet', 'Manquant', 'Remplacé', 'À remplacer', 'Conforme']
const ARM_PRESETS = ['Conforme', 'Non conforme', 'Cassée', 'Rouillée', 'Remplacée', 'Manquante']

/* ─── Helpers ─── */
function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtTs(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
function isoDate(d) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

/* ─── AutoField ─── */
function AutoField({ label, icon: Icon, children, saving }) {
  return (
    <div className="fiche-field-row">
      <div className="fiche-field-label">
        {Icon && <Icon size={13} />}
        {label}
      </div>
      <div className="fiche-field-input">
        {children}
      </div>
      {saving && <span className="fiche-saving-dot" />}
    </div>
  )
}

/* ─── Presets ─── */
function Presets({ presets, value, onSelect }) {
  return (
    <div className="fiche-presets">
      {presets.map(p => (
        <button
          key={p} type="button"
          className={`fiche-preset-chip${value === p ? ' fiche-preset-chip--active' : ''}`}
          onClick={() => onSelect(value === p ? '' : p)}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

/* ─── PctInput ─── */
function PctInput({ value, onChange, onBlur, readOnly }) {
  const cls = value == null ? '' : value >= 80 ? 'fiche-pct-bar--ok' : value >= 40 ? 'fiche-pct-bar--warn' : 'fiche-pct-bar--bad'
  return (
    <div className="fiche-pct-wrap">
      <div className="fiche-pct-row">
        <input
          className={`fiche-pct-input${readOnly ? ' fiche-input--ro' : ''}`}
          type="number" min={0} max={100}
          value={value ?? ''}
          onChange={e => !readOnly && onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          onBlur={onBlur}
          placeholder="-"
          readOnly={readOnly}
        />
        <span className="fiche-pct-unit">%</span>
      </div>
      <div className="fiche-pct-track">
        <div
          className={`fiche-pct-fill ${cls}`}
          style={{ width: value != null ? `${Math.min(value, 100)}%` : '0%', opacity: value != null ? 1 : 0 }}
        />
      </div>
    </div>
  )
}

/* ─── CloseConfirm ─── */
function CloseConfirm({ onClose, onConfirm, loading }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><CheckCircle2 size={16} /> Clôturer l'intervention</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            En clôturant l'intervention, le statut passera à <strong>Terminé</strong> et elle ne pourra plus être modifiée.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={onConfirm} disabled={loading}>
            {loading ? <span className="login-btn-spinner" /> : <><CheckCircle2 size={14} /> Clôturer</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Page ─── */
export default function InterventionFichePage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isTech   = user?.role === 'technicien'
  const isAdmin  = !isTech && (
    user?.role === 'superadmin' || user?.role === 'admin' ||
    user?.permissions?.canManageInterventions
  )

  /* ── State ── */
  const [iv,             setIv]             = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [tab,            setTab]            = useState('fiche')
  const [fiche,          setFiche]          = useState({})
  const [savingField,    setSavingField]    = useState(null)
  const [savedField,     setSavedField]     = useState(null)
  const [uploading,      setUploading]      = useState(false)
  const [deletingPic,    setDeletingPic]    = useState(null)
  const [showClose,      setShowClose]      = useState(false)
  const [closing,        setClosing]        = useState(false)
  const [lightbox,       setLightbox]       = useState(null)
  const [deviceOpen,     setDeviceOpen]     = useState(true)

  // Admin-only
  const [techniciens,      setTechniciens]      = useState([])
  const [adminForm,        setAdminForm]        = useState({ scheduledDate: '', notes: '', technicien: '', technicienName: '' })
  const [savingAdminField, setSavingAdminField] = useState(null)
  const [savedAdminField,  setSavedAdminField]  = useState(null)

  useLoadingBar(loading)

  /* ── Load ── */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getIntervention(id)
      setIv(data)
      setFiche({
        serialNumber:        data.fiche?.serialNumber        ?? data.installationSnap?.serialNumber ?? '',
        emplacement:         data.fiche?.emplacement         ?? data.installationSnap?.location     ?? '',
        signaletique:        data.fiche?.signaletique        ?? '',
        batteriePct:         data.fiche?.batteriePct         ?? undefined,
        batterieNote:        data.fiche?.batterieNote        ?? '',
        electrodesPct:       data.fiche?.electrodesPct       ?? undefined,
        electrodesNote:      data.fiche?.electrodesNote      ?? '',
        armoire:             data.fiche?.armoire             ?? '',
        observation:         data.fiche?.observation         ?? '',
        dateReception:       data.fiche?.dateReception ? isoDate(data.fiche.dateReception) : isoDate(data.scheduledDate) || '',
        visa:                data.fiche?.visa                ?? '',
        observationGenerale: data.fiche?.observationGenerale ?? '',
      })
    } catch {
      toast.error('Intervention introuvable.')
      navigate('/interventions')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  // Sync adminForm from iv
  useEffect(() => {
    if (!iv) return
    setAdminForm({
      scheduledDate:  isoDate(iv.scheduledDate),
      notes:          iv.notes || '',
      technicien:     iv.technicien?._id || (typeof iv.technicien === 'string' ? iv.technicien : '') || '',
      technicienName: iv.technicienName || iv.technicien?.fullName || '',
    })
  }, [iv])

  // Fetch technicians list for admin
  useEffect(() => {
    if (!isAdmin) return
    get('/users?role=technicien&limit=100')
      .then(res => setTechniciens(Array.isArray(res) ? res : res.data || []))
      .catch(() => {})
  }, [isAdmin])

  // Keyboard nav for lightbox
  useEffect(() => {
    if (lightbox === null) return
    const photos = iv?.fiche?.photos || []
    function onKey(e) {
      if (e.key === 'Escape')     setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(i => (i + 1) % photos.length)
      if (e.key === 'ArrowLeft')  setLightbox(i => (i - 1 + photos.length) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, iv])

  /* ── Fiche handlers ── */
  function set(k, v) { setFiche(f => ({ ...f, [k]: v })) }

  async function autoSave(field, value) {
    setSavingField(field)
    try {
      const updated = await saveFiche(id, { [field]: value ?? null })
      setIv(updated)
      setSavedField(field)
      setTimeout(() => setSavedField(f => f === field ? null : f), 2000)
    } catch {
      toast.error('Erreur de sauvegarde.')
    } finally {
      setSavingField(null)
    }
  }

  function handleBlur(field) { autoSave(field, fiche[field]) }

  async function handlePreset(field, val) {
    set(field, val)
    await autoSave(field, val)
  }

  /* ── Admin handlers ── */
  async function saveAdmin(field, value, techName) {
    setSavingAdminField(field)
    try {
      const payload = { [field]: value }
      if (field === 'technicien') {
        payload.technicienName = techName ?? adminForm.technicienName
      }
      const updated = await updateIntervention(id, payload)
      setIv(prev => ({
        ...prev,
        scheduledDate:  updated.scheduledDate  ?? prev.scheduledDate,
        notes:          updated.notes          !== undefined ? updated.notes : prev.notes,
        technicien:     updated.technicien     ?? prev.technicien,
        technicienName: updated.technicienName ?? prev.technicienName,
        history:        updated.history        ?? prev.history,
      }))
      setSavedAdminField(field)
      setTimeout(() => setSavedAdminField(f => f === field ? null : f), 2000)
    } catch {
      toast.error('Erreur de sauvegarde.')
    } finally {
      setSavingAdminField(null)
    }
  }

  /* ── Photo handlers ── */
  async function handleUploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const updated = await uploadFichePhoto(id, file)
      setIv(updated)
    } catch (err) {
      toast.error(err.message || 'Erreur upload.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeletePhoto(filename) {
    setDeletingPic(filename)
    try {
      const updated = await deleteFichePhoto(id, filename)
      setIv(updated)
      if (lightbox !== null) setLightbox(null)
    } catch (err) {
      toast.error(err.message || 'Erreur suppression.')
    } finally {
      setDeletingPic(null)
    }
  }

  async function handleClose() {
    setClosing(true)
    try {
      const updated = await closeIntervention(id)
      setIv(updated)
      setShowClose(false)
      toast.success('Intervention clôturée.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosing(false)
    }
  }

  /* ── Early return ── */
  if (loading || !iv) {
    return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  }

  const snap          = iv.installationSnap || {}
  const isTermine     = iv.status === 'termine'
  const photos        = iv.fiche?.photos || []
  const meta          = STATUS_META[iv.status] || STATUS_META.planifie
  const StatusIcon    = meta.Icon
  const readOnly      = !isTech || isTermine   // fiche fields: tech-only, blocked when done
  const adminReadOnly = isTermine              // admin fields: blocked for everyone when done

  const deviceImgFile = iv.installation?.deviceProduct?.images?.[0]
  const deviceImg     = deviceImgFile
    ? `${STATIC_BASE}/uploads/products/${deviceImgFile}`
    : null

  // Helper: field props — use neutral placeholder when readOnly
  function field(key, value, placeholder) {
    return {
      value: value ?? '',
      onChange: e => set(key, e.target.value),
      onBlur: () => handleBlur(key),
      readOnly,
      className: `fiche-input${readOnly ? ' fiche-input--ro' : ''}`,
      placeholder: readOnly ? '—' : (placeholder || ''),
    }
  }

  const isSaving = savingField || savingAdminField
  const isSaved  = savedField  || savedAdminField

  return (
    <div className={`page-content${!isTermine ? ' fiche-page--with-closebar' : ''}`}>
      {/* ── Header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate('/interventions')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {iv.clientName || '—'}
              <span className={meta.cls}>
                <StatusIcon size={11} strokeWidth={2.5} /> {meta.label}
              </span>
            </h1>
            <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-muted)' }}>
              {snap.deviceType && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={12} /> {snap.deviceType}
                </span>
              )}
              {(snap.address || snap.location) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} /> {snap.address}{snap.location ? ` · ${snap.location}` : ''}
                </span>
              )}
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} /> Planifié le {fmt(iv.scheduledDate)}
              </span>
              {iv.technicienName && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> {iv.technicienName}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(isSaving || isSaved) && (
            <span className="fiche-save-indicator">
              {isSaving
                ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Sauvegarde…</>
                : <><Save size={12} /> Sauvegardé</>
              }
            </span>
          )}
          <button
            className="btn btn--ghost"
            onClick={() => window.open(`/interventions/${id}/print`, '_blank')}
          >
            <Download size={14} /> PDF
          </button>
          {!isTermine && (
            <button className="btn btn--primary" onClick={() => setShowClose(true)}>
              <CheckCircle2 size={14} /> Clôturer l'intervention
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="pd-tabs" style={{ marginBottom: 8 }}>
        <button
          className={`pd-tab${tab === 'fiche' ? ' pd-tab--active' : ''}`}
          onClick={() => setTab('fiche')}
        >
          <ClipboardList size={13} /> Fiche
        </button>
        <button
          className={`pd-tab${tab === 'history' ? ' pd-tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          <History size={13} /> Historique
          {iv.history?.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              background: 'var(--gray-200)', color: 'var(--text-muted)',
              borderRadius: 999, padding: '0 6px', marginLeft: 4,
            }}>
              {iv.history.length}
            </span>
          )}
        </button>
      </div>

      {/* ══ History tab ══ */}
      {tab === 'history' && (
        <div style={{ padding: '8px 0 48px' }}>
          {(!iv.history || iv.history.length === 0) ? (
            <div className="table-empty" style={{ padding: '64px 0', textAlign: 'center' }}>
              Aucun historique disponible.
            </div>
          ) : (
            <div className="iv-history">
              {[...iv.history].reverse().map((h, i) => (
                <div key={i} className="iv-history-item">
                  <div className="iv-history-dot" />
                  <div>
                    <div className="iv-history-action">
                      {h.details || ACTION_LABELS[h.action] || h.action}
                    </div>
                    <div className="iv-history-meta">
                      {h.userName && <>{h.userName} · </>}
                      {fmtTs(h.date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Fiche tab ══ */}
      {tab === 'fiche' && (
        <>
          {/* Notes pour le technicien */}
          {!isAdmin && iv.notes && (
            <div className="fiche-admin-notes">
              <StickyNote size={13} />
              <span>{iv.notes}</span>
            </div>
          )}

          {/* ── Section planification (admin) ── */}
          {isAdmin && (
            <div className="fiche-page-section">
              <div className="fiche-page-section-title">
                <Calendar size={14} /> Planification
                {adminReadOnly && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                    Lecture seule — intervention clôturée
                  </span>
                )}
              </div>
              <div className="fiche-page-body">
                <div className="fiche-row-2col">
                  <AutoField label="Date planifiée" icon={Calendar} saving={savingAdminField === 'scheduledDate'}>
                    <input
                      type="date"
                      className={`fiche-input${adminReadOnly ? ' fiche-input--ro' : ''}`}
                      value={adminForm.scheduledDate}
                      readOnly={adminReadOnly}
                      onChange={e => !adminReadOnly && setAdminForm(f => ({ ...f, scheduledDate: e.target.value }))}
                      onBlur={() => !adminReadOnly && saveAdmin('scheduledDate', adminForm.scheduledDate)}
                    />
                    {savedAdminField === 'scheduledDate' && <span className="fiche-saved-ok">✓</span>}
                  </AutoField>

                  <AutoField label="Technicien assigné" icon={User} saving={savingAdminField === 'technicien'}>
                    <div className="fiche-select-wrap" style={{ width: '100%' }}>
                      <select
                        className={`fiche-input${adminReadOnly ? ' fiche-input--ro' : ''}`}
                        value={adminForm.technicien}
                        disabled={adminReadOnly}
                        style={{ paddingRight: 28 }}
                        onChange={async e => {
                          if (adminReadOnly) return
                          const tech = techniciens.find(t => t._id === e.target.value)
                          const name = tech?.fullName || tech?.username || ''
                          setAdminForm(f => ({ ...f, technicien: e.target.value, technicienName: name }))
                          await saveAdmin('technicien', e.target.value, name)
                        }}
                      >
                        <option value="">— Non assigné —</option>
                        {techniciens.map(t => (
                          <option key={t._id} value={t._id}>{t.fullName || t.username}</option>
                        ))}
                      </select>
                      {!adminReadOnly && <ChevronDown size={13} className="fiche-select-chevron" />}
                    </div>
                    {savedAdminField === 'technicien' && <span className="fiche-saved-ok">✓</span>}
                  </AutoField>
                </div>

                <AutoField label="Notes / Observations" icon={StickyNote} saving={savingAdminField === 'notes'}>
                  <textarea
                    className={`fiche-input fiche-textarea${adminReadOnly ? ' fiche-input--ro' : ''}`}
                    rows={3}
                    placeholder={adminReadOnly ? 'Pas de note' : 'Notes visibles par le technicien…'}
                    value={adminForm.notes}
                    readOnly={adminReadOnly}
                    onChange={e => !adminReadOnly && setAdminForm(f => ({ ...f, notes: e.target.value }))}
                    onBlur={() => !adminReadOnly && saveAdmin('notes', adminForm.notes)}
                  />
                  {savedAdminField === 'notes' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>
              </div>
            </div>
          )}

          {/* ── Section appareil ── */}
          <div className="fiche-page-section">
            <button
              type="button"
              className="fiche-device-header"
              onClick={() => setDeviceOpen(o => !o)}
            >
              <div className="fiche-device-thumb">
                {deviceImg
                  ? <img src={deviceImg} alt={snap.deviceType} className="fiche-device-img" />
                  : <span className="fiche-device-icon"><Zap size={20} /></span>
                }
              </div>
              <div className="fiche-device-meta">
                <span className="fiche-device-name">{snap.deviceType || 'DAE'}</span>
                <div className="fiche-device-sub">
                  {(fiche.serialNumber || snap.serialNumber) && (
                    <span><Hash size={10} /> {fiche.serialNumber || snap.serialNumber}</span>
                  )}
                  {snap.address && (
                    <span><MapPin size={10} /> {snap.address}{snap.location ? ` · ${snap.location}` : ''}</span>
                  )}
                </div>
              </div>
              <ChevronDown
                size={16}
                className={`fiche-device-chevron${deviceOpen ? ' fiche-device-chevron--open' : ''}`}
              />
            </button>

            {deviceOpen && (
              <div className="fiche-page-body">
                <AutoField label="Numéro de série" icon={Hash} saving={savingField === 'serialNumber'}>
                  <input {...field('serialNumber', fiche.serialNumber, 'ex. SN-2024-0042')} />
                  {savedField === 'serialNumber' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                <AutoField label="Emplacement" icon={Navigation} saving={savingField === 'emplacement'}>
                  <input {...field('emplacement', fiche.emplacement, "ex. Hall d'entrée, 2e étage…")} />
                  {savedField === 'emplacement' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                <AutoField label="État signalétique" icon={Shield} saving={savingField === 'signaletique'}>
                  <input {...field('signaletique', fiche.signaletique, 'Description libre…')} />
                  {!readOnly && (
                    <Presets presets={SIG_PRESETS} value={fiche.signaletique} onSelect={v => handlePreset('signaletique', v)} />
                  )}
                  {savedField === 'signaletique' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                <AutoField label="État batterie" icon={Battery} saving={savingField === 'batteriePct' || savingField === 'batterieNote'}>
                  <div className="fiche-two-fields">
                    <PctInput
                      value={fiche.batteriePct}
                      onChange={v => set('batteriePct', v)}
                      onBlur={() => handleBlur('batteriePct')}
                      readOnly={readOnly}
                    />
                    <textarea
                      {...field('batterieNote', fiche.batterieNote, 'Note sur la batterie…')}
                      className={`fiche-input fiche-textarea-sm${readOnly ? ' fiche-input--ro' : ''}`}
                      placeholder={readOnly ? 'Pas de note' : 'Note sur la batterie…'}
                      rows={2}
                    />
                  </div>
                  {savedField === 'batterieNote' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                <AutoField label="État électrodes" icon={Radio} saving={savingField === 'electrodesPct' || savingField === 'electrodesNote'}>
                  <div className="fiche-two-fields">
                    <PctInput
                      value={fiche.electrodesPct}
                      onChange={v => set('electrodesPct', v)}
                      onBlur={() => handleBlur('electrodesPct')}
                      readOnly={readOnly}
                    />
                    <textarea
                      {...field('electrodesNote', fiche.electrodesNote, 'Note sur les électrodes…')}
                      className={`fiche-input fiche-textarea-sm${readOnly ? ' fiche-input--ro' : ''}`}
                      placeholder={readOnly ? 'Pas de note' : 'Note sur les électrodes…'}
                      rows={2}
                    />
                  </div>
                  {savedField === 'electrodesNote' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                <AutoField label="Armoire / Boîtier" icon={Package} saving={savingField === 'armoire'}>
                  <input {...field('armoire', fiche.armoire, 'Description libre…')} />
                  {!readOnly && (
                    <Presets presets={ARM_PRESETS} value={fiche.armoire} onSelect={v => handlePreset('armoire', v)} />
                  )}
                  {savedField === 'armoire' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                <AutoField label="Observation" icon={StickyNote} saving={savingField === 'observation'}>
                  <textarea
                    {...field('observation', fiche.observation, 'Remarques, anomalies constatées…')}
                    className={`fiche-input fiche-textarea${readOnly ? ' fiche-input--ro' : ''}`}
                    placeholder={readOnly ? 'Pas de note' : 'Remarques, anomalies constatées…'}
                    rows={3}
                  />
                  {savedField === 'observation' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                {/* Photos */}
                <div className="fiche-field-row fiche-field-row--photos">
                  <div className="fiche-field-label"><Camera size={13} /> Photos</div>
                  <div className="fiche-photos-grid">
                    {photos.map((filename, idx) => (
                      <div key={filename} className="fiche-photo-thumb">
                        <img
                          src={fichePhotoUrl(filename)}
                          alt="photo"
                          className="fiche-photo-img"
                          onClick={() => setLightbox(idx)}
                        />
                        {!readOnly && (
                          <button
                            className="fiche-photo-del"
                            disabled={deletingPic === filename}
                            onClick={() => handleDeletePhoto(filename)}
                          >
                            {deletingPic === filename
                              ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                              : <X size={11} />
                            }
                          </button>
                        )}
                      </div>
                    ))}
                    {photos.length === 0 && readOnly && (
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune photo</span>
                    )}
                    {!readOnly && (
                      <label className="fiche-photo-add">
                        {uploading
                          ? <span className="spinner" />
                          : <><ImagePlus size={20} /><span>Ajouter</span></>
                        }
                        <input
                          type="file" accept="image/*" capture="environment"
                          style={{ display: 'none' }}
                          onChange={handleUploadPhoto}
                          disabled={uploading}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Section visite ── */}
          <div className="fiche-page-section">
            <div className="fiche-page-section-title">
              <Calendar size={14} /> Informations de visite
            </div>
            <div className="fiche-page-body">
              <div className="fiche-row-2col">
                <AutoField label="Date de réception" icon={Calendar} saving={savingField === 'dateReception'}>
                  <input type="date" {...field('dateReception', fiche.dateReception)} />
                  {savedField === 'dateReception' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>
                <AutoField label="Visa / Signature" icon={User} saving={savingField === 'visa'}>
                  <input {...field('visa', fiche.visa, 'Nom du responsable…')} />
                  {savedField === 'visa' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>
              </div>
              <AutoField label="Observation générale" icon={StickyNote} saving={savingField === 'observationGenerale'}>
                <textarea
                  {...field('observationGenerale', fiche.observationGenerale, 'Observations générales sur cette intervention…')}
                  className={`fiche-input fiche-textarea${readOnly ? ' fiche-input--ro' : ''}`}
                  placeholder={readOnly ? 'Pas de note' : 'Observations générales sur cette intervention…'}
                  rows={3}
                />
                {savedField === 'observationGenerale' && <span className="fiche-saved-ok">✓</span>}
              </AutoField>
            </div>
          </div>

          {/* Clôturer */}
          {!isTermine && (
            <div className="fiche-close-bar">
              <p className="fiche-close-hint">Tout est saisi ? Vous pouvez clôturer l'intervention.</p>
              <button className="btn btn--primary" style={{ minWidth: 200 }} onClick={() => setShowClose(true)}>
                <CheckCircle2 size={15} /> Clôturer l'intervention
              </button>
            </div>
          )}

          {isTermine && (
            <div className="fiche-done-bar">
              <CheckCircle2 size={16} />
              Intervention clôturée le {fmt(iv.completedDate)}
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {showClose && (
        <CloseConfirm
          onClose={() => setShowClose(false)}
          onConfirm={handleClose}
          loading={closing}
        />
      )}

      {lightbox !== null && photos.length > 0 && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}><X size={20} /></button>
          {photos.length > 1 && (
            <button className="lightbox-nav lightbox-nav--prev"
              onClick={e => { e.stopPropagation(); setLightbox(i => (i - 1 + photos.length) % photos.length) }}>
              ‹
            </button>
          )}
          <img
            className="lightbox-img"
            src={fichePhotoUrl(photos[lightbox])}
            alt="photo"
            onClick={e => e.stopPropagation()}
          />
          {photos.length > 1 && (
            <button className="lightbox-nav lightbox-nav--next"
              onClick={e => { e.stopPropagation(); setLightbox(i => (i + 1) % photos.length) }}>
              ›
            </button>
          )}
          {!readOnly && (
            <button
              className="lightbox-delete"
              onClick={e => { e.stopPropagation(); handleDeletePhoto(photos[lightbox]) }}
              disabled={deletingPic === photos[lightbox]}
            >
              <Trash2 size={16} /> Supprimer
            </button>
          )}
          {photos.length > 1 && (
            <div className="lightbox-counter">{lightbox + 1} / {photos.length}</div>
          )}
        </div>
      )}
    </div>
  )
}
