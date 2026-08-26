import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, CheckCircle2, Clock, AlertCircle, MapPin, Zap,
  Camera, Trash2, X, Save, ImagePlus, Hash, Navigation,
  Shield, Battery, Radio, Package, StickyNote, Calendar, User,
  ChevronDown, ClipboardList, History, Download, FileText, Building2, Wrench, Check,
  Pencil, Lock, Unlock, BatteryMedium, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  getIntervention, saveFiche, removeFiche, closeIntervention,
  uploadFichePhoto, deleteFichePhoto, fichePhotoUrl,
  updateIntervention, saveDeaItems,
} from '../api/interventions'
import { get, STATIC_BASE } from '../api/http'
import { useLoadingBar } from '../hooks/useLoadingBar'
import { useGoBack } from '../hooks/useGoBack'
import ReplacementModal from '../components/ReplacementModal'
import FicheDeaTabs, { deaLabel as deaLabelOf } from '../components/FicheDeaTabs'
import DeaItemsModal from '../components/DeaItemsModal'
import { expiryHint } from '../components/siteHelpers'
import {
  getReplacements, replacementKind, replacementStatus, replacementReason,
} from '../api/replacements'

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
  correction:    'Correction après clôture',
  sync_parc:     'Fiche client mise à jour depuis la checklist',
}

const SIG_PRESETS = ['Complet', 'Incomplet', 'Manquant', 'Remplacé', 'À remplacer', 'Conforme']
const ARM_PRESETS = ['Conforme', 'Non conforme', 'Cassée', 'Rouillée', 'Remplacée', 'Manquante']

const ELECTRODE_TYPES = [
  { value: 'capteur_rcp',      label: 'Avec capteur RCP' },
  { value: 'sans_capteur_rcp', label: 'Sans capteur RCP' },
  { value: 'universelle',      label: 'Universelle' },
]

/** Samedi → lundi (+2), dimanche → lundi (+1). Voir `skipWeekend` côté serveur. */
function shiftOffWeekend(dateStr) {
  if (!dateStr) return dateStr
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const day = d.getDay()
  if (day === 6) d.setDate(d.getDate() + 2)
  else if (day === 0) d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

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
function isoDateTime(d) {
  if (!d) return ''
  const dt = new Date(d)
  const pad = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}
function fmtTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
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

/* ─── Pièce remplacée ───
   « Remplacée » sans dire laquelle ne sert à personne : le magasin ne sait pas
   quoi déduire du stock, et le client ne sait pas ce qu'il a reçu. Cocher ouvre
   donc le signalement, où le technicien choisit la pièce posée — ou bascule en
   demande de remplacement, auquel cas rien ne sort du stock. */
function ReplacedRow({ label, done, reference, readOnly, onDeclare, onClear }) {
  return (
    <div className="fiche-replaced">
      <span className="fiche-replaced-label">{label}</span>
      {done ? (
        <span className="fiche-replaced-done">
          <CheckCircle2 size={13} />
          <span>Remplacée{reference ? ' · ' : ''}<strong>{reference}</strong></span>
          {!readOnly && (
            <button type="button" className="fiche-replaced-undo" title="Annuler cette mention"
              onClick={onClear}><X size={11} /></button>
          )}
        </span>
      ) : readOnly ? (
        <span className="fiche-replaced-none">Non</span>
      ) : (
        <button type="button" className="fiche-replaced-btn" onClick={onDeclare}>
          <Wrench size={12} /> Déclarer un remplacement
        </button>
      )}
    </div>
  )
}

/* ─── CheckPoint ───
   Point de contrôle de la checklist : conforme / non conforme / non vérifié.
   Trois états et non deux : une case vide ne doit pas se lire comme un défaut,
   elle veut dire « pas encore regardé ». */
function CheckPoint({ label, value, onChange, readOnly }) {
  const set = v => !readOnly && onChange(value === v ? undefined : v)

  return (
    <div className="fiche-check">
      <span className="fiche-check-label">{label}</span>
      <div className="fiche-check-btns">
        <button
          type="button"
          className={`fiche-check-btn fiche-check-btn--ok${value === true ? ' fiche-check-btn--on' : ''}`}
          onClick={() => set(true)}
          disabled={readOnly}
          title="Conforme"
        >
          <Check size={13} />
        </button>
        <button
          type="button"
          className={`fiche-check-btn fiche-check-btn--ko${value === false ? ' fiche-check-btn--on' : ''}`}
          onClick={() => set(false)}
          disabled={readOnly}
          title="Non conforme"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

/* ─── Champ date compact de la checklist ─── */
/* `expiry` : la date porte une péremption, on en donne le délai en clair —
   « 01/12/2027 » ne se convertit pas de tête en nombre de jours. */
function DateField({ label, value, onChange, onBlur, readOnly, expiry }) {
  const hint = expiry ? expiryHint(value) : null
  return (
    <div className="fiche-datefield">
      <span className="fiche-datefield-label">{label}</span>
      <input
        type="date"
        className={`fiche-input${readOnly ? ' fiche-input--ro' : ''}`}
        value={value || ''}
        readOnly={readOnly}
        onChange={e => !readOnly && onChange(e.target.value)}
        onBlur={onBlur}
      />
      {hint && <p className={`expiry-hint expiry-hint--${hint.level}`}>{hint.text}</p>}
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

/* ─── Pièce en place sur l'appareil ─── */
/**
 * Ce que le parc dit être monté sur le DAE — batterie ou électrodes.
 *
 * Contrôler l'état d'une pièce que personne n'a identifiée ne mène nulle part :
 * on coche « absence de corrosion » sans savoir de quelle batterie il s'agit,
 * et la fiche client reste vide. Tant que le parc l'ignore, la section reste
 * verrouillée et cette barre demande l'identification. Elle écrit dans le parc,
 * pas dans la fiche : ce qui est saisi ici est aussitôt visible côté client.
 */
function ParcItemsBar({ kind, items, readOnly, onEdit }) {
  const isBatt = kind === 'batteries'
  const Icon   = isBatt ? BatteryMedium : Radio
  const noun   = isBatt ? 'la batterie' : 'les électrodes'

  if (!items.length) {
    return (
      <div className="fiche-parc-bar fiche-parc-bar--missing">
        <AlertTriangle size={14} />
        <span>
          Aucune {isBatt ? 'batterie' : 'électrode'} enregistrée sur cet appareil.
          {!readOnly && <> Identifiez {noun} en place avant d'en contrôler l'état.</>}
        </span>
        {!readOnly && (
          <button type="button" className="btn btn--primary btn--sm" onClick={onEdit}>
            <Icon size={13} /> Renseigner {noun}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="fiche-parc-bar">
      <Icon size={14} />
      <div className="fiche-parc-items">
        {items.map((it, i) => (
          <span key={it._id || i} className="fiche-parc-item">
            <strong>{it.productName || (isBatt ? 'Batterie' : 'Électrodes')}</strong>
            {it.kind && <> · {it.kind}</>}
            {(it.serialNumber || it.lotNumber) && <> · {it.serialNumber || it.lotNumber}</>}
            {it.expiryDate && <> · exp. {new Date(it.expiryDate).toLocaleDateString('fr-FR')}</>}
          </span>
        ))}
      </div>
      {!readOnly && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}>
          <Pencil size={13} /> Modifier
        </button>
      )}
    </div>
  )
}

/* ─── CloseConfirm ─── */
function CloseConfirm({ onClose, onConfirm, loading, onBehalf }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><CheckCircle2 size={16} /> Clôturer l'intervention</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            En clôturant l'intervention, le statut passera à <strong>Terminé</strong> et la fiche ne sera plus modifiable sur le terrain.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10 }}>
            Les relevés de la checklist — péremptions, niveau de batterie, n° de série,
            emplacement — seront reportés sur la fiche client, et la date de prochain
            contrôle sur le planning.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10 }}>
            Un administrateur pourra encore la rouvrir pour corriger une erreur — la correction est alors tracée dans l'historique.
          </p>
          {onBehalf && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10 }}>
              Vous clôturez à la place du technicien assigné : la clôture sera enregistrée à votre nom dans l'historique, et le technicien ne pourra plus saisir sa fiche.
            </p>
          )}
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

/* ─── Contexte du contrôle (type + installation + contrat) ─── */
const CTRL_CTX = {
  semestriel:   { label: 'Semestriel (contrat)', cls: 'ct-type-badge ct-type-badge--semestriel' },
  annuel:       { label: 'Annuel (contrat)',     cls: 'ct-type-badge ct-type-badge--annuel' },
  hors_contrat: { label: 'Hors contrat',         cls: 'ct-type-badge ct-type-badge--hors' },
}
function ControlContextSection({ iv, navigate }) {
  const ct       = CTRL_CTX[iv.controlType] || CTRL_CTX.hors_contrat
  const contract = iv.contract
  const site     = iv.site
  const snap     = iv.installationSnap || {}
  // Le parc n'a plus de fiche propre : l'appareil se décrit sur place, et c'est
  // le site qui s'ouvre.
  const device   = [snap.deviceType, snap.serialNumber].filter(Boolean).join(' · ')
  const address  = site?.address
    ? [site.address.street, site.address.city].filter(Boolean).join(' · ')
    : snap.address

  return (
    <div className="fiche-page-section">
      <div className="fiche-page-section-title"><ClipboardList size={14} /> Contexte du contrôle</div>
      <div className="fiche-page-body">
        <div className="ctx-grid">
          <div className="ctx-item">
            <span className="ctx-label">Type de contrôle</span>
            <span className={ct.cls}>{ct.label}</span>
          </div>
          <div className="ctx-item">
            <span className="ctx-label">Site</span>
            {site?._id ? (
              <button type="button" className="cell-link" onClick={() => navigate(`/sites/${site._id}`)}>
                <Building2 size={12} /> {site.name || iv.siteName || 'Voir le site'}
              </button>
            ) : iv.siteName
              ? <span className="ctx-value"><Building2 size={12} /> {iv.siteName}</span>
              : <span className="ctx-muted">Non précisé</span>}
          </div>
          <div className="ctx-item">
            <span className="ctx-label">Appareil</span>
            {device
              ? <span className="ctx-value"><Zap size={12} /> {device}</span>
              : <span className="ctx-muted">Tout le site</span>}
          </div>
          <div className="ctx-item">
            <span className="ctx-label">Contrat</span>
            {contract?._id ? (
              <button type="button" className="cell-link" onClick={() => navigate(`/contrats/${contract._id}`)}>
                <FileText size={12} /> {contract.contractNumber || 'Voir le contrat'}
              </button>
            ) : <span className="ctx-muted">Hors contrat</span>}
          </div>
          {snap.location && (
            <div className="ctx-item">
              <span className="ctx-label">Emplacement</span>
              <span className="ctx-value"><MapPin size={12} /> {snap.location}</span>
            </div>
          )}
          {address && (
            <div className="ctx-item">
              <span className="ctx-label">Adresse</span>
              <span className="ctx-value"><MapPin size={12} /> {address}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Page ─── */
export default function InterventionFichePage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const goBack   = useGoBack('/interventions')
  const { user } = useAuth()
  const isTech   = user?.role === 'technicien'
  const isSuper  = user?.role === 'superadmin'
  const isAdmin  = !isTech && (
    isSuper || user?.role === 'admin' ||
    user?.permissions?.canManageInterventions
  )
  /* La checklist appartient au technicien qui fait la visite. Le superadmin y
     accède quand même — fiche vierge comprise — et peut la saisir et clôturer
     à sa place : une visite faite mais non saisie (technicien parti, tablette
     hors service) doit pouvoir être régularisée sans repasser sur site. */
  const canFill  = isTech || isSuper

  /* ── State ── */
  const [iv,             setIv]             = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [tab,            setTab]            = useState('fiche')
  // Une fiche par appareil contrôlé, plus les champs de la visite entière.
  const [fiches,         setFiches]         = useState([])
  const [activeKey,      setActiveKey]      = useState('')
  const [visite,         setVisite]         = useState({})
  const [declaring,      setDeclaring]      = useState(null)   // { kind, field, refField, label }
  const [savingField,    setSavingField]    = useState(null)
  const [savedField,     setSavedField]     = useState(null)
  const [uploading,      setUploading]      = useState(false)
  const [deletingPic,    setDeletingPic]    = useState(null)
  const [showClose,      setShowClose]      = useState(false)
  /* Mode correction : une intervention clôturée reste figée à l'écran tant que
     l'admin ne demande pas explicitement à la rouvrir. On ne corrige pas une
     fiche validée par inadvertance. */
  const [unlocked,       setUnlocked]       = useState(false)
  // Identification de la pièce montée : 'batteries' | 'electrodes' | null.
  const [itemsKind,      setItemsKind]      = useState(null)
  const [closing,        setClosing]        = useState(false)
  const [lightbox,       setLightbox]       = useState(null)
  const [deviceOpen,     setDeviceOpen]     = useState(true)
  const [replaceOpen,    setReplaceOpen]    = useState(false)
  const [weekendShifted, setWeekendShifted] = useState(false)
  const [replacements,   setReplacements]   = useState([])

  // Admin-only
  const [techniciens,      setTechniciens]      = useState([])
  const [adminForm,        setAdminForm]        = useState({ scheduledDate: '', notes: '', technicien: '', technicienName: '' })
  const [savingAdminField, setSavingAdminField] = useState(null)
  const [savedAdminField,  setSavedAdminField]  = useState(null)

  useLoadingBar(loading)

  /* Fiche affichée. Tout le formulaire lit et écrit dans celle-ci. */
  const activeFiche = useMemo(
    () => fiches.find(f => f.key === activeKey) || fiches[0] || {},
    [fiches, activeKey])

  /* ── Load ── */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getIntervention(id)
      setIv(data)

      /* Les appareils à contrôler : celui que vise le contrôle, sinon tout le
         parc du site — une visite de contrat les couvre tous. Le technicien
         peut en retirer ou en ajouter, mais il n'a rien à composer d'avance. */
      const siteDeas = data.siteDeas || []
      const targets  = data.installation
        ? siteDeas.filter(d => String(d._id) === String(data.installation))
        : siteDeas

      const saved = Array.isArray(data.fiches) ? data.fiches : []
      const byKey = new Map(saved.map(f => [String(f.dea || ''), f]))

      /* Le technicien ne ressaisit pas ce que l'application connaît : le n° de
         série et l'emplacement viennent du parc quand la fiche est vierge.
         `||` et non `??` : un champ enregistré vide doit pouvoir se remplir. */
      const fromDea = (dea, f = {}) => ({
        key:          String(dea?._id || f.dea || ''),
        dea:          dea?._id || f.dea || null,
        deaLabel:     f.deaLabel || deaLabelOf(dea) || '',
        serialNumber: f.serialNumber || dea?.serialNumber || '',
        emplacement:  f.emplacement  || dea?.location     || '',
        signaletique: f.signaletique ?? '',

        batteriePeremption:   f.batteriePeremption,
        batteriePct:          f.batteriePct ?? undefined,
        batterieEtat:         f.batterieEtat,
        batterieRemplacee:    f.batterieRemplacee,
        batterieRemplaceeRef: f.batterieRemplaceeRef ?? '',
        batterieNote:         f.batterieNote ?? '',

        electrodesPeremptionAdulte:      f.electrodesPeremptionAdulte,
        electrodesPeremptionPediatrique: f.electrodesPeremptionPediatrique,
        electrodesEmballage:     f.electrodesEmballage,
        electrodesAdaptees:      f.electrodesAdaptees,
        electrodesType:          f.electrodesType ?? '',
        electrodesRemplacees:    f.electrodesRemplacees,
        electrodesRemplaceesRef: f.electrodesRemplaceesRef ?? '',
        electrodesPct:           f.electrodesPct ?? undefined,
        electrodesNote:          f.electrodesNote ?? '',

        kitGants:       f.kitGants,
        kitCiseaux:     f.kitCiseaux,
        kitRasoir:      f.kitRasoir,
        kitMasque:      f.kitMasque,
        kitCompresses:  f.kitCompresses,
        kitRemplace:    f.kitRemplace,
        kitRemplaceRef: f.kitRemplaceRef ?? '',

        voyantVert:        f.voyantVert,
        autotests:         f.autotests,
        armoire:           f.armoire ?? '',
        armoireAccessible: f.armoireAccessible,
        armoirePiles:      f.armoirePiles,

        dernierControle:  f.dernierControle,
        prochainControle: f.prochainControle,
        observation:      f.observation ?? '',
      })

      const list = []
      targets.forEach(d => list.push(fromDea(d, byKey.get(String(d._id)) || {})))
      // Fiches déjà saisies sur un appareil hors cible (ou d'avant le multi-DAE).
      saved.forEach(f => {
        const key = String(f.dea || '')
        if (list.some(e => e.key === key)) return
        list.push(fromDea(siteDeas.find(d => String(d._id) === key), f))
      })
      if (list.length === 0) list.push(fromDea(null, {}))

      setFiches(list)
      setActiveKey(prev => (list.some(e => e.key === prev) ? prev : list[0].key))
      setVisite({
        dateReception: data.visite?.dateReception
          ? isoDate(data.visite.dateReception)
          : isoDate(data.scheduledDate) || '',
        visa:                data.visite?.visa                ?? '',
        observationGenerale: data.visite?.observationGenerale ?? '',
      })
    } catch {
      toast.error('Intervention introuvable.')
      navigate('/interventions')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  /* Ce qui a déjà été signalé pendant ce contrôle, pour ne pas le signaler deux
     fois — et pour que le technicien voie que sa demande est partie. */
  useEffect(() => {
    getReplacements({ intervention: id })
      .then(res => setReplacements(res.data || []))
      .catch(() => {})
  }, [id])

  // Sync adminForm from iv
  useEffect(() => {
    if (!iv) return
    setAdminForm({
      scheduledDate:  isoDateTime(iv.scheduledDate),
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
  /* Toutes les saisies portent sur l'appareil affiché : `activeKey` accompagne
     donc chaque enregistrement, côté serveur comme côté état local. */
  function set(k, v) {
    setFiches(list => list.map(f => (f.key === activeKey ? { ...f, [k]: v } : f)))
  }
  function setVisiteField(k, v) { setVisite(s => ({ ...s, [k]: v })) }

  /* Le parc du site et le visuel de l'appareil sont joints par la lecture
     complète ; les enregistrements partiels ne les renvoient pas. Sans cette
     fusion, la première sauvegarde ferait disparaître la photo et le choix
     de l'appareil.
     Même chose pour les références peuplées : un enregistrement renvoie le
     document brut, où `site` n'est plus qu'un identifiant. Les écrans qui
     testent `iv.site?._id` — identification d'une pièce, signalement d'un
     remplacement — cessaient donc de s'ouvrir dès la première saisie. */
  const keepPopulated = (prev, next) => (next && next._id ? next : (prev ?? next))

  function mergeIv(updated, { parc = false } = {}) {
    setIv(prev => ({
      ...updated,
      site:          keepPopulated(prev?.site,       updated.site),
      client:        keepPopulated(prev?.client,     updated.client),
      technicien:    keepPopulated(prev?.technicien, updated.technicien),
      contract:      keepPopulated(prev?.contract,   updated.contract),
      /* `parc` : la réponse porte un parc frais — une pièce vient d'y être
         identifiée. Sans ça la barre continuerait d'annoncer l'appareil vide. */
      siteDeas:      parc ? updated.siteDeas      : (prev?.siteDeas      ?? updated.siteDeas),
      deviceProduct: parc ? updated.deviceProduct : (prev?.deviceProduct ?? updated.deviceProduct),
    }))
  }

  async function autoSave(field, value, opts = {}) {
    setSavingField(field)
    try {
      const body = opts.visite
        ? { [field]: value ?? null }
        : { dea: activeKey || undefined, deaLabel: activeFiche?.deaLabel, [field]: value ?? null }
      const updated = await saveFiche(id, body)
      mergeIv(updated)
      setSavedField(field)
      setTimeout(() => setSavedField(f => f === field ? null : f), 2000)
    } catch {
      toast.error('Erreur de sauvegarde.')
    } finally {
      setSavingField(null)
    }
  }

  /* Plusieurs champs d'un coup (choix d'un appareil, pièce remplacée) : les
     enregistrer ensemble évite une fiche à moitié à jour si l'une échoue. */
  async function saveFields(values) {
    setSavingField('serialNumber')
    try {
      mergeIv(await saveFiche(id, {
        dea: activeKey || undefined,
        deaLabel: activeFiche?.deaLabel,
        ...values,
      }))
    } catch {
      toast.error('Erreur de sauvegarde.')
    } finally {
      setSavingField(null)
    }
  }

  function handleBlur(field) { autoSave(field, activeFiche?.[field]) }
  function handleVisiteBlur(field) { autoSave(field, visite[field], { visite: true }) }

  /* ── Appareils de la visite ── */
  function addDea(deaId) {
    const dea = (iv?.siteDeas || []).find(d => String(d._id) === String(deaId))
    if (!dea || fiches.some(f => f.key === String(deaId))) return
    setFiches(list => [...list, {
      key: String(dea._id), dea: dea._id, deaLabel: deaLabelOf(dea),
      serialNumber: dea.serialNumber || '', emplacement: dea.location || '',
      signaletique: '', electrodesType: '', armoire: '', observation: '',
      batterieNote: '', electrodesNote: '',
      batterieRemplaceeRef: '', electrodesRemplaceesRef: '', kitRemplaceRef: '',
    }])
    setActiveKey(String(dea._id))
  }

  async function dropDea(key) {
    const entry = fiches.find(f => f.key === key)
    if (!entry) return
    if (!window.confirm(`Retirer « ${entry.deaLabel || 'cet appareil'} » de cette visite ? La saisie le concernant sera perdue.`)) return
    try {
      // Rien à supprimer côté serveur tant qu'aucun champ n'a été enregistré.
      const updated = await removeFiche(id, key || 'none').catch(err => {
        if (err.status === 404) return null
        throw err
      })
      if (updated) mergeIv(updated)
    } catch (err) {
      toast.error(err.message || 'Suppression impossible.')
      return
    }
    setFiches(list => {
      const next = list.filter(f => f.key !== key)
      setActiveKey(k => (k === key ? (next[0]?.key ?? '') : k))
      return next
    })
  }

  async function handlePreset(field, val) {
    set(field, val)
    await autoSave(field, val)
  }

  /* Un point de contrôle n'a pas de « blur » : le clic vaut saisie, donc on
     enregistre aussitôt. */
  async function checkPoint(field, val) {
    set(field, val)
    await autoSave(field, val)
  }

  /* La date du prochain contrôle ne tombe pas un week-end : on la reporte au
     lundi et on le signale, plutôt que de laisser planifier une visite un
     samedi. Même règle que le calendrier généré par les contrats. */
  function setProchainControle(value) {
    const shifted = shiftOffWeekend(value)
    setWeekendShifted(Boolean(value) && shifted !== value)
    set('prochainControle', shifted)
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
      const updated = await uploadFichePhoto(id, file, activeKey || undefined)
      mergeIv(updated)
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
      mergeIv(updated)
      if (lightbox !== null) setLightbox(null)
    } catch (err) {
      toast.error(err.message || 'Erreur suppression.')
    } finally {
      setDeletingPic(null)
    }
  }

  /**
   * Pièce identifiée sur l'appareil : elle va au parc, pas dans la fiche.
   *
   * La péremption relevée au catalogue remplit la checklist si elle est encore
   * vide — le technicien vient de la lire sur l'étiquette, la ressaisir deux
   * fois n'apporte rien. Une valeur déjà saisie n'est jamais écrasée : c'est
   * elle qui vient du terrain.
   */
  async function handleItemsSaved(kind, updated) {
    setItemsKind(null)
    mergeIv(updated, { parc: true })

    const dea = (updated.siteDeas || []).find(d => String(d._id) === activeKey)
    const prefill = {}
    if (kind === 'batteries') {
      const exp = dea?.batteries?.[0]?.expiryDate
      if (exp && !activeFiche?.batteriePeremption) prefill.batteriePeremption = exp
    } else {
      const adulte = dea?.electrodes?.find(e => e.kind === 'adulte' || !e.kind)
      const enfant = dea?.electrodes?.find(e => e.kind === 'enfant')
      if (adulte?.expiryDate && !activeFiche?.electrodesPeremptionAdulte) {
        prefill.electrodesPeremptionAdulte = adulte.expiryDate
      }
      if (enfant?.expiryDate && !activeFiche?.electrodesPeremptionPediatrique) {
        prefill.electrodesPeremptionPediatrique = enfant.expiryDate
      }
    }
    if (!Object.keys(prefill).length) return
    Object.entries(prefill).forEach(([k, v]) => set(k, v))
    await saveFields(prefill)
  }

  async function handleClose() {
    setClosing(true)
    try {
      const updated = await closeIntervention(id)
      mergeIv(updated)
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
  const fiche         = activeFiche
  // Les photos vivent côté serveur : c'est la fiche enregistrée qui fait foi.
  const photos        = (iv.fiches || []).find(f => String(f.dea || '') === activeKey)?.photos
    || (iv.fiches?.length ? [] : iv.fiche?.photos) || []
  const meta          = STATUS_META[iv.status] || STATUS_META.planifie
  const StatusIcon    = meta.Icon
  /* Une visite clôturée ne se ressaisit plus : ni le technicien ni le
     superadmin n'y touchent. Seul l'administrateur peut la rouvrir pour
     corriger une erreur relevée après coup — chaque passage est tracé. */
  const canCorrect    = isAdmin && isTermine
  const correcting    = canCorrect && unlocked
  const readOnly      = correcting ? false : (!canFill || isTermine)  // fiche fields
  /* Aucune fiche enregistrée côté serveur : rien n'a encore été saisi. Les
     entrées locales, elles, sont pré-remplies depuis le parc et ne disent rien. */
  const ficheVierge   = !(iv.fiches?.length)
  const adminReadOnly = isTermine && !correcting  // admin fields: rouverts en mode correction

  const deviceImgFile = iv.deviceProduct?.images?.[0]
  const deviceImg     = deviceImgFile
    ? `${STATIC_BASE}/uploads/products/${deviceImgFile}`
    : null

  /* Parc du site : il alimente l'en-tête de l'appareil et la liste de ceux qui
     restent à ajouter à la visite. */
  const siteDeas   = iv.siteDeas || []
  const activeDea  = siteDeas.find(d => String(d._id) === activeKey) || null
  const addableDeas = siteDeas.filter(d => !fiches.some(f => f.key === String(d._id)))

  /* Le parc dit ce qui est monté sur l'appareil. Tant qu'il l'ignore, l'état de
     la pièce ne se contrôle pas : on ne coche pas « pas de corrosion » sur une
     batterie que personne n'a identifiée. */
  const parcBatteries  = activeDea?.batteries  || []
  const parcElectrodes = activeDea?.electrodes || []
  /* Le verrou suppose un appareil connu du parc. Une fiche qui n'est rattachée
     à aucun DAE — visite d'avant les sites, appareil retiré du parc depuis —
     se saisit comme avant : la bloquer ne la rendrait pas plus juste. */
  const parcKnown     = Boolean(activeDea)
  /* Pièce non identifiée : les points de contrôle ne sont pas grisés, ils ne
     s'affichent pas. Un formulaire figé sur un appareil vide n'apprend rien à
     personne et laisse croire qu'il y a quelque chose à lire. */
  const attendBatterie   = parcKnown && parcBatteries.length === 0
  const attendElectrodes = parcKnown && parcElectrodes.length === 0

  const deviceLabel   = activeDea?.deviceType || fiche.deaLabel || snap.deviceType || 'DAE'
  const siteAddress   = iv.site?.address
    ? [iv.site.address.street, iv.site.address.city].filter(Boolean).join(' · ')
    : ''
  const deviceAddress = snap.address || siteAddress

  /* Une pièce déclarée remplacée : la fiche retient laquelle, le stock est
     déduit par le signalement lui-même (sauf demande de remplacement). */
  function applyReplacement(saved) {
    const decl = declaring
    setDeclaring(null)
    setReplacements(l => [saved, ...l])
    if (!decl) return
    if (saved.status !== 'remplace') {
      toast.info('Demande enregistrée — la pièce reste à remplacer, rien n\'est déduit du stock.')
      return
    }
    const ref = saved.replacementSerial || saved.replacementItem?.serialNumber
      || saved.replacementItem?.lotNumber || ''
    set(decl.field, true)
    set(decl.refField, ref)
    saveFields({ [decl.field]: true, [decl.refField]: ref })
  }

  function clearReplacement(field, refField) {
    if (!window.confirm('Retirer cette mention de la fiche ? Le mouvement de stock déjà enregistré, lui, se reprend depuis la page Remplacements.')) return
    set(field, undefined)
    set(refField, '')
    saveFields({ [field]: null, [refField]: '' })
  }

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

  /* Champs de la visite : saisis une fois pour toute l'intervention. */
  function visiteField(key, placeholder) {
    return {
      value: visite[key] ?? '',
      onChange: e => setVisiteField(key, e.target.value),
      onBlur: () => handleVisiteBlur(key),
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
          <button className="back-btn" onClick={goBack} title="Retour">
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
                <Calendar size={12} /> Planifié le {fmt(iv.scheduledDate)}{iv.scheduledDate ? ` à ${fmtTime(iv.scheduledDate)}` : ''}
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
          {canFill && !isTermine && (
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
              {[...iv.history].reverse().map((h, i) => {
                /* Une correction après clôture porte le détail des champs
                   touchés : on le déplie plutôt que d'aligner une longue
                   phrase que personne ne relit. */
                const detailed = h.action === 'correction' || h.action === 'sync_parc'
                const changes = detailed && h.details
                  ? h.details.split(' · ').filter(Boolean)
                  : null
                return (
                  <div key={i} className="iv-history-item">
                    <div className="iv-history-dot" />
                    <div>
                      <div className="iv-history-action">
                        {changes ? ACTION_LABELS[h.action] : (h.details || ACTION_LABELS[h.action] || h.action)}
                      </div>
                      {changes && (
                        <ul className="iv-history-changes">
                          {changes.map((c, j) => <li key={j}>{c}</li>)}
                        </ul>
                      )}
                      <div className="iv-history-meta">
                        {h.userName && <>{h.userName} · </>}
                        {fmtTs(h.date)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ Fiche tab ══ */}
      {tab === 'fiche' && (
        <>
          {/* Contexte (installation / contrat / type) — vue non-technicien */}
          {!isTech && <ControlContextSection iv={iv} navigate={navigate} />}

          {/* Notes pour le technicien */}
          {!isAdmin && iv.notes && (
            <div className="fiche-admin-notes">
              <StickyNote size={13} />
              <span>{iv.notes}</span>
            </div>
          )}

          {/* Une panne se signale au moment où on la constate, pas après coup :
              le bouton reste à portée tant que l'intervention est ouverte. */}
          {!isTermine && iv.site?._id && (
            <div className="fiche-report-bar">
              <div className="fiche-report-text">
                <Wrench size={14} />
                <span>Une pièce est défectueuse, périmée ou manquante ?</span>
              </div>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => setReplaceOpen(true)}>
                Signaler un remplacement
              </button>
            </div>
          )}

          {replacements.length > 0 && (
            <div className="fiche-page-section">
              <div className="fiche-page-section-title">
                <Wrench size={14} /> Remplacements signalés ({replacements.length})
              </div>
              <div className="fiche-page-body">
                <div className="rep-mini-list">
                  {replacements.map(r => (
                    <div key={r._id} className="rep-mini">
                      <span className={`rep-badge rep-badge--${replacementStatus(r.status).tone}`}>
                        {replacementStatus(r.status).label}
                      </span>
                      <span className="rep-mini-main">
                        {replacementKind(r.kind).label}
                        {(r.serialNumber || r.lotNumber) && <> · {r.serialNumber || r.lotNumber}</>}
                      </span>
                      <span className="rep-mini-sub">{replacementReason(r.reason).label}</span>
                    </div>
                  ))}
                </div>
              </div>
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
                  <AutoField label="Date et heure planifiées" icon={Calendar} saving={savingAdminField === 'scheduledDate'}>
                    <input
                      type="datetime-local"
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

          {/* Fiche appareil — technicien et superadmin : toujours ; les autres :
              seulement une fois remplie/validée */}
          {(canFill || isTermine) ? (
          <>
          {/* Le superadmin qui ouvre une fiche encore vierge doit savoir qu'il
              saisit à la place du technicien, pas qu'il relit son travail. */}
          {isSuper && !isTech && !isTermine && (
            <div className="fiche-admin-notes">
              <ClipboardList size={13} />
              <span>
                {ficheVierge
                  ? "Fiche non encore remplie par le technicien. En tant que superadmin vous pouvez la saisir et clôturer l'intervention à sa place — chaque saisie est tracée à votre nom dans l'historique."
                  : "Saisie en cours par le technicien. En tant que superadmin vous pouvez la compléter et clôturer l'intervention — vos modifications sont tracées à votre nom."}
              </span>
            </div>
          )}

          {/* Correction après clôture : la fiche redevient saisissable, mais on
              rappelle en permanence qu'on écrit dans une visite déjà validée. */}
          {correcting && (
            <div className="fiche-correction-note">
              <Unlock size={14} />
              <span>
                <strong>Mode correction.</strong> L'intervention reste clôturée : vos
                modifications sont enregistrées immédiatement et tracées à votre nom
                dans l'historique.
              </span>
            </div>
          )}

          {/* Une visite couvre souvent plusieurs DAE du site : chacun a sa
              fiche, et le technicien passe de l'un à l'autre ici. */}
          <FicheDeaTabs
            entries={fiches}
            activeKey={activeKey}
            onSelect={setActiveKey}
            onAdd={addDea}
            onRemove={dropDea}
            addable={addableDeas}
            readOnly={readOnly}
          />

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
                <span className="fiche-device-name">{deviceLabel}</span>
                <div className="fiche-device-sub">
                  {fiche.serialNumber && <span><Hash size={10} /> {fiche.serialNumber}</span>}
                  {deviceAddress && (
                    <span><MapPin size={10} /> {deviceAddress}
                      {fiche.emplacement ? ` · ${fiche.emplacement}` : ''}</span>
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

                <AutoField label="Batterie" icon={Battery} saving={savingField === 'batteriePct' || savingField === 'batterieNote'}>
                  {parcKnown && (
                    <ParcItemsBar
                      kind="batteries"
                      items={parcBatteries}
                      readOnly={readOnly}
                      onEdit={() => setItemsKind('batteries')}
                    />
                  )}
                  {!attendBatterie && (<>
                  <DateField
                    label="Date de péremption"
                    value={isoDate(fiche.batteriePeremption)}
                    expiry
                    onChange={v => set('batteriePeremption', v)}
                    onBlur={() => handleBlur('batteriePeremption')}
                    readOnly={readOnly}
                  />
                  <div className="fiche-check-group">
                    <CheckPoint label="Absence de détérioration ou de corrosion"
                      value={fiche.batterieEtat} readOnly={readOnly}
                      onChange={v => checkPoint('batterieEtat', v)} />
                    <ReplacedRow
                      label="Batterie remplacée"
                      done={fiche.batterieRemplacee}
                      reference={fiche.batterieRemplaceeRef}
                      readOnly={readOnly}
                      onDeclare={() => setDeclaring({
                        kind: 'batterie', field: 'batterieRemplacee',
                        refField: 'batterieRemplaceeRef',
                      })}
                      onClear={() => clearReplacement('batterieRemplacee', 'batterieRemplaceeRef')}
                    />
                  </div>
                  <span className="fiche-sub-label">Niveau de charge indiqué par l'appareil</span>
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
                  </>)}
                </AutoField>

                <AutoField label="Électrodes" icon={Radio} saving={savingField === 'electrodesPct' || savingField === 'electrodesNote'}>
                  {parcKnown && (
                    <ParcItemsBar
                      kind="electrodes"
                      items={parcElectrodes}
                      readOnly={readOnly}
                      onEdit={() => setItemsKind('electrodes')}
                    />
                  )}
                  {!attendElectrodes && (<>
                  {/* Deux jeux distincts sur la checklist : adulte et pédiatrique. */}
                  <div className="fiche-date-row">
                    <DateField
                      label="Péremption adulte"
                      value={isoDate(fiche.electrodesPeremptionAdulte)}
                      expiry
                      onChange={v => set('electrodesPeremptionAdulte', v)}
                      onBlur={() => handleBlur('electrodesPeremptionAdulte')}
                      readOnly={readOnly}
                    />
                    <DateField
                      label="Péremption pédiatrique"
                      value={isoDate(fiche.electrodesPeremptionPediatrique)}
                      expiry
                      onChange={v => set('electrodesPeremptionPediatrique', v)}
                      onBlur={() => handleBlur('electrodesPeremptionPediatrique')}
                      readOnly={readOnly}
                    />
                  </div>

                  <span className="fiche-sub-label">Type d'électrodes</span>
                  <div className="fiche-presets">
                    {ELECTRODE_TYPES.map(t => (
                      <button key={t.value} type="button"
                        className={`fiche-preset-chip${fiche.electrodesType === t.value ? ' fiche-preset-chip--active' : ''}`}
                        disabled={readOnly}
                        onClick={() => handlePreset('electrodesType',
                          fiche.electrodesType === t.value ? '' : t.value)}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="fiche-check-group">
                    <CheckPoint label="Intégrité de l'emballage hermétique"
                      value={fiche.electrodesEmballage} readOnly={readOnly}
                      onChange={v => checkPoint('electrodesEmballage', v)} />
                    <CheckPoint label="Présence des électrodes adaptées"
                      value={fiche.electrodesAdaptees} readOnly={readOnly}
                      onChange={v => checkPoint('electrodesAdaptees', v)} />
                    <ReplacedRow
                      label="Électrodes remplacées"
                      done={fiche.electrodesRemplacees}
                      reference={fiche.electrodesRemplaceesRef}
                      readOnly={readOnly}
                      onDeclare={() => setDeclaring({
                        kind: 'electrodes', field: 'electrodesRemplacees',
                        refField: 'electrodesRemplaceesRef',
                      })}
                      onClear={() => clearReplacement('electrodesRemplacees', 'electrodesRemplaceesRef')}
                    />
                  </div>

                  <span className="fiche-sub-label">État général</span>
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
                  </>)}
                </AutoField>

                {/* Kit de secours — absent de la fiche jusqu'ici. */}

                <AutoField label="Kit de secours" icon={Package}>
                  <div className="fiche-check-group">
                    <CheckPoint label="Gants de protection présents"
                      value={fiche.kitGants} readOnly={readOnly}
                      onChange={v => checkPoint('kitGants', v)} />
                    <CheckPoint label="Ciseaux disponibles"
                      value={fiche.kitCiseaux} readOnly={readOnly}
                      onChange={v => checkPoint('kitCiseaux', v)} />
                    <CheckPoint label="Rasoir présent"
                      value={fiche.kitRasoir} readOnly={readOnly}
                      onChange={v => checkPoint('kitRasoir', v)} />
                    <CheckPoint label="Masque de ventilation disponible"
                      value={fiche.kitMasque} readOnly={readOnly}
                      onChange={v => checkPoint('kitMasque', v)} />
                    <CheckPoint label="Compresses présentes"
                      value={fiche.kitCompresses} readOnly={readOnly}
                      onChange={v => checkPoint('kitCompresses', v)} />
                    <CheckPoint label="Kit remplacé"
                      value={fiche.kitRemplace} readOnly={readOnly}
                      onChange={v => checkPoint('kitRemplace', v)} />
                    {fiche.kitRemplaceRef && (
                      <div className="fiche-replaced">
                        <span className="fiche-replaced-label">Référence du kit posé</span>
                        <span className="fiche-replaced-done"><CheckCircle2 size={13} /> {fiche.kitRemplaceRef}</span>
                      </div>
                    )}
                  </div>
                </AutoField>

                {/* État général de l'appareil et de son armoire. */}
                <AutoField label="État général du DAE" icon={Shield}>
                  <div className="fiche-check-group">
                    <CheckPoint label="Voyant de fonctionnement au vert"
                      value={fiche.voyantVert} readOnly={readOnly}
                      onChange={v => checkPoint('voyantVert', v)} />
                    <CheckPoint label="Autotests réalisés correctement"
                      value={fiche.autotests} readOnly={readOnly}
                      onChange={v => checkPoint('autotests', v)} />
                    <CheckPoint label="Armoire accessible et correctement signalée"
                      value={fiche.armoireAccessible} readOnly={readOnly}
                      onChange={v => checkPoint('armoireAccessible', v)} />
                    <CheckPoint label="État des piles de l'armoire"
                      value={fiche.armoirePiles} readOnly={readOnly}
                      onChange={v => checkPoint('armoirePiles', v)} />
                  </div>
                </AutoField>

                <AutoField label="Armoire" icon={Package} saving={savingField === 'armoire'}>
                  <input {...field('armoire', fiche.armoire, 'Description libre…')} />
                  {!readOnly && (
                    <Presets presets={ARM_PRESETS} value={fiche.armoire} onSelect={v => handlePreset('armoire', v)} />
                  )}
                  {savedField === 'armoire' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>

                {/* Suivi documentaire — la date du prochain contrôle évite le
                    week-end, comme le calendrier des contrats. */}
                <AutoField label="Suivi documentaire" icon={ClipboardList}>
                  <div className="fiche-date-row">
                    <DateField
                      label="Dernier contrôle enregistré"
                      value={isoDate(fiche.dernierControle)}
                      onChange={v => set('dernierControle', v)}
                      onBlur={() => handleBlur('dernierControle')}
                      readOnly={readOnly}
                    />
                    <DateField
                      label="Prochain contrôle planifié"
                      value={isoDate(fiche.prochainControle)}
                      onChange={v => setProchainControle(v)}
                      onBlur={() => handleBlur('prochainControle')}
                      readOnly={readOnly}
                    />
                  </div>
                  {weekendShifted && (
                    <p className="fiche-hint">
                      Date reportée au lundi : les visites ne se font pas le week-end.
                    </p>
                  )}
                  {!readOnly && fiche.prochainControle && (
                    <p className="fiche-hint">
                      À la clôture, la prochaine visite du site sera déplacée à cette date dans le planning.
                    </p>
                  )}
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
              <span className="fiche-section-note">Commun à tous les appareils</span>
            </div>
            <div className="fiche-page-body">
              <div className="fiche-row-2col">
                <AutoField label="Date de réception" icon={Calendar} saving={savingField === 'dateReception'}>
                  <input type="date" {...visiteField('dateReception', 'Date de réception')} />
                  {savedField === 'dateReception' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>
                <AutoField label="Visa / Signature" icon={User} saving={savingField === 'visa'}>
                  <input {...visiteField('visa', 'Nom du responsable…')} />
                  {savedField === 'visa' && <span className="fiche-saved-ok">✓</span>}
                </AutoField>
              </div>
              <AutoField label="Observation générale" icon={StickyNote} saving={savingField === 'observationGenerale'}>
                <textarea
                  {...visiteField('observationGenerale', 'Observations générales sur cette intervention…')}
                  className={`fiche-input fiche-textarea${readOnly ? ' fiche-input--ro' : ''}`}
                  rows={3}
                />
                {savedField === 'observationGenerale' && <span className="fiche-saved-ok">✓</span>}
              </AutoField>
            </div>
          </div>
          </>
          ) : (
            <div className="fiche-page-section">
              <div className="fiche-locked-note">
                <Clock size={20} />
                <div>
                  <strong>Fiche non encore remplie</strong>
                  <p>Le technicien n'a pas encore rempli et validé la fiche d'intervention. Elle s'affichera ici une fois le contrôle réalisé.</p>
                </div>
              </div>
            </div>
          )}

          {/* Clôturer — technicien assigné, ou superadmin à sa place */}
          {canFill && !isTermine && (
            <div className="fiche-close-bar">
              <p className="fiche-close-hint">
                {isTech
                  ? "Tout est saisi ? Vous pouvez clôturer l'intervention."
                  : "Tout est saisi ? Vous pouvez clôturer l'intervention à la place du technicien."}
              </p>
              <button className="btn btn--primary" style={{ minWidth: 200 }} onClick={() => setShowClose(true)}>
                <CheckCircle2 size={15} /> Clôturer l'intervention
              </button>
            </div>
          )}

          {isTermine && (
            <div className={`fiche-done-bar${correcting ? ' fiche-done-bar--editing' : ''}`}>
              {correcting ? <Unlock size={16} /> : <CheckCircle2 size={16} />}
              <span>
                {correcting
                  ? 'Correction en cours — intervention clôturée le ' + fmt(iv.completedDate)
                  : 'Intervention clôturée le ' + fmt(iv.completedDate)}
              </span>
              {canCorrect && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setUnlocked(u => !u)}
                >
                  {correcting
                    ? <><Lock size={14} /> Terminer les corrections</>
                    : <><Pencil size={14} /> Corriger la checklist</>}
                </button>
              )}
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
          onBehalf={!isTech}
        />
      )}

      {/* Identification de la pièce montée : la même modale que la fiche
          client, mais enregistrée par la route de l'intervention — le
          technicien n'a pas le droit de gestion des clients. */}
      {itemsKind && iv.site?._id && activeDea && (
        <DeaItemsModal
          site={iv.site}
          dea={activeDea}
          kind={itemsKind}
          onClose={() => setItemsKind(null)}
          save={items => saveDeaItems(id, itemsKind, activeDea._id, items)}
          onSaved={updated => handleItemsSaved(itemsKind, updated)}
        />
      )}

      {replaceOpen && iv.site?._id && (
        <ReplacementModal
          site={iv.site}
          deas={siteDeas}
          dea={activeDea || (iv.installation ? siteDeas.find(d => String(d._id) === String(iv.installation)) : null)}
          intervention={iv}
          onClose={() => setReplaceOpen(false)}
          onSaved={saved => { setReplacements(l => [saved, ...l]); setReplaceOpen(false) }}
        />
      )}

      {/* Déclaration d'une pièce posée depuis la checklist : la même modale,
          ouverte sur le bon élément et déjà en « déjà remplacé ». */}
      {declaring && iv.site?._id && (
        <ReplacementModal
          site={iv.site}
          deas={siteDeas}
          dea={activeDea}
          presetKind={declaring.kind}
          presetStatus="remplace"
          intervention={iv}
          onClose={() => setDeclaring(null)}
          onSaved={applyReplacement}
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
