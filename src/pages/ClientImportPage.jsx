import { useState, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  ArrowLeft, Upload, Download, FileSpreadsheet, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, RotateCcw, Check,
  Users, Info, Building2, HeartPulse, Columns3, CalendarClock,
  Package, Sparkles, Link2, Ban, Calendar, FileSignature, Wand2,
  ClipboardList, GitMerge, Archive, ShieldAlert,
} from 'lucide-react'
import { validateImport, executeImport } from '../api/clients'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'

/* ── Modèle de fichier ───────────────────────────────────────
   Une ligne = un DAE. Les colonnes client et site se répètent d'une ligne à
   l'autre ; les lignes sont regroupées à l'import. Une ligne sans colonne DAE
   crée simplement le client et son site. Les intitulés sont ceux du fichier
   de suivi des contrats. */

const SAMPLE_COLUMNS = [
  // Client
  { key: 'Client',                group: 'client', label: 'Client', required: true },
  { key: 'Contrat',               group: 'client', label: 'Sous contrat' },
  { key: 'Forfait Contrat',       group: 'client', label: 'Forfait' },
  // Site
  { key: 'Nom du site',           group: 'site', label: 'Nom du site' },
  { key: 'Adresse',               group: 'site', label: 'Adresse' },
  { key: 'Ville',                 group: 'site', label: 'Ville' },
  { key: 'Gouvernorat',           group: 'site', label: 'Gouvernorat' },
  { key: 'Responsable du site',   group: 'site', label: 'Responsable' },
  { key: 'Téléphone',             group: 'site', label: 'Téléphone' },
  { key: 'Email',                 group: 'site', label: 'Email' },
  { key: 'Pack',                  group: 'site', label: 'Pack' },
  // DAE
  { key: 'Type DEA',              group: 'dae', label: 'Modèle' },
  { key: 'Serial Number',         group: 'dae', label: 'N° de série' },
  { key: 'Emplacement',           group: 'dae', label: 'Emplacement' },
  { key: "Date d'installation",   group: 'dae', label: 'Date de pose' },
  { key: 'Dernier Contrôle',      group: 'dae', label: 'Dernier contrôle' },
  // Consommables
  { key: 'Type de Batterie',      group: 'conso', label: 'Batterie' },
  { key: 'Installation Batterie', group: 'conso', label: 'Pose batterie' },
  { key: 'Batterie DLC',          group: 'conso', label: 'DLC batterie' },
  { key: 'Niveau de batterie',    group: 'conso', label: 'Charge' },
  { key: 'Electrode',             group: 'conso', label: 'DLC élec. adulte' },
  { key: 'Electrode RCP',         group: 'conso', label: 'DLC élec. RCP' },
  { key: 'Electrode Universelle', group: 'conso', label: 'DLC élec. univ.' },
  { key: 'Electrode P',           group: 'conso', label: 'DLC élec. pédia.' },
  // Armoire
  { key: 'Type Armoire',          group: 'armoire', label: 'Type' },
  { key: 'Pile Armoire',          group: 'armoire', label: 'Piles' },
]

const GROUP_LABELS = {
  client: 'Client',
  site:   'Site',
  dae:    'DAE',
  conso:  'Consommables',
  armoire: 'Armoire',
}

const SAMPLE_ROWS = [
  ['Clinique El Amel', 'OUI', '',
   'Bloc A', '12 Av. Habib Bourguiba', 'Tunis', 'Tunis', 'Salah Mabrouk', '71 100 201', 'bloc.a@elamel.tn', 'OUI',
   'POWERHEART G5', 'D00000096721', "Hall d'entrée", '12/03/2024', '01/08/2026',
   'INTELLISENSE G5', '12/03/2024', '12/03/2029', '100%', '28/11/2027', '', '', '28/11/2027', 'AIVIA 100', ''],
  // Même client, même site : seul le DAE change
  ['Clinique El Amel', 'OUI', '',
   'Bloc A', '', '', '', '', '', '', '',
   'POWERHEART G5', 'D00000096722', 'Étage 2 — couloir', '15/04/2024', '01/08/2026',
   'INTELLISENSE G5', '15/04/2024', '15/04/2029', '90%', '', '28/05/2027', '', '', 'AIVIA 100', 'Epuisé'],
  // Deuxième site du même client, encore sans DAE posé
  ['Clinique El Amel', 'OUI', '',
   'Annexe La Marsa', '3 Rue du Lac', 'La Marsa', 'Tunis', 'Nadia Karray', '71 100 202', '', 'NON',
   '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Mairie de Sfax', 'NON', '',
   'Hôtel de ville', 'Place de la Liberté', 'Sfax', 'Sfax', 'Anis Trabelsi', '74 200 300', '', 'NON',
   'ZOLL AED PLUS', 'X23I693409', 'Accueil', '02/09/2023', '15/06/2026',
   'PILE CR123', '02/09/2023', '02/09/2028', '80%', '31/08/2027', '', '', '', 'AIVIA IN', 'OK'],
]

function downloadSample() {
  const ws = XLSX.utils.aoa_to_sheet([
    SAMPLE_COLUMNS.map(c => c.key),
    ...SAMPLE_ROWS,
  ])

  ws['!cols'] = SAMPLE_COLUMNS.map(() => ({ wch: 20 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Parc')
  XLSX.writeFile(wb, 'modele_import_parc.xlsx')
}

const RESET_PHRASE = 'REINITIALISER'

const LEVEL_LABELS = { error: 'Bloquant', warn: 'À vérifier', info: 'Corrigé automatiquement' }

/**
 * Rapport d'analyse en Excel, à transmettre à qui tient le fichier de suivi :
 * une feuille par constat, une feuille ligne à ligne.
 */
function downloadAnalysis(validation, fileName) {
  const wb = XLSX.utils.book_new()

  const constats = [['Gravité', 'Catégorie', 'Détail', 'Lignes Excel']]
  for (const g of validation.analysis) {
    for (const item of g.items) {
      constats.push([LEVEL_LABELS[g.level] || g.level, g.title, item.text, item.rows.join(', ')])
    }
  }
  const ws1 = XLSX.utils.aoa_to_sheet(constats)
  ws1['!cols'] = [{ wch: 22 }, { wch: 44 }, { wch: 110 }, { wch: 30 }]
  ws1['!autofilter'] = { ref: `A1:D${constats.length}` }
  XLSX.utils.book_append_sheet(wb, ws1, 'Constats')

  const lignes = [['Ligne Excel', 'Client', 'Site', 'Modèle', 'N° de série', 'Statut', 'À vérifier', 'Corrections']]
  for (const r of validation.results) {
    lignes.push([
      r.rowNum, r.clientName, r.siteName, r.row.deaType || '', r.row.deaSerial || '',
      r.valid ? (r.warnings.length ? 'À vérifier' : 'OK') : 'Écartée',
      [...r.errors, ...r.warnings].join(' | '),
      r.fixes.join(' | '),
    ])
  }
  const ws2 = XLSX.utils.aoa_to_sheet(lignes)
  ws2['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 28 }, { wch: 26 }, { wch: 16 }, { wch: 11 }, { wch: 90 }, { wch: 70 }]
  ws2['!autofilter'] = { ref: `A1:H${lignes.length}` }
  XLSX.utils.book_append_sheet(wb, ws2, 'Lignes')

  const base = String(fileName || 'import').replace(/\.[^.]+$/, '')
  XLSX.writeFile(wb, `${base}_analyse.xlsx`)
}

/* Batterie et électrodes d'une ligne, résumées pour l'aperçu. */
function ConsumablesCell({ row }) {
  const lines = []
  if (row.battProductName || row.battExpiry || row.battLevel) {
    lines.push(`Batt. ${[row.battExpiry, row.battLevel && `${row.battLevel} %`].filter(Boolean).join(' · ') || row.battProductName}`)
  }
  const elec = [
    ['elecAdultExpiry', 'A'], ['elecCprExpiry', 'RCP'], ['elecUniversalExpiry', 'U'],
    ['elecChildExpiry', 'P'], ['elecExpiry', row.elecKind || ''],
  ].filter(([k]) => row[k]).map(([k, l]) => `${l ? `${l} ` : ''}${row[k]}`)
  if (elec.length) lines.push(`Élec. ${elec.join(' · ')}`)
  if (row.armoireModel || row.armoirePiles) {
    lines.push(`Arm. ${[row.armoireModel, row.armoirePiles && (row.armoirePiles === 'a_remplacer' ? 'piles à remplacer' : 'piles OK')].filter(Boolean).join(' · ')}`)
  }
  if (lines.length === 0) return <em className="ci-cell--empty">—</em>
  return lines.map((line, i) => <div key={i}>{line}</div>)
}

/* Un groupe du rapport d'analyse, replié par défaut. */
function AnalysisGroup({ group }) {
  const [open, setOpen] = useState(false)
  const Icon = group.level === 'info' ? Wand2 : group.level === 'error' ? XCircle : AlertTriangle
  return (
    <div className={`ci-an-group ci-an-group--${group.level}`}>
      <button className="ci-an-head" onClick={() => setOpen(o => !o)}>
        <Icon size={14} />
        <span className="ci-an-title">{group.title}</span>
        <span className="ci-an-count">
          {group.count} constat{group.count > 1 ? 's' : ''}
          {group.rowCount > 0 && ` · ${group.rowCount} ligne${group.rowCount > 1 ? 's' : ''}`}
        </span>
        <ChevronRight size={13} className={`ci-map-caret${open ? ' ci-map-caret--open' : ''}`} />
      </button>
      {open && (
        <div className="ci-an-body">
          {group.hint && <p className="ci-an-hint">{group.hint}</p>}
          <ul className="ci-an-items">
            {group.items.map((item, i) => (
              <li key={i}>
                <span>{item.text}</span>
                {item.rows.length > 0 && (
                  <span className="ci-an-rows">
                    {item.rows.length > 12
                      ? `l. ${item.rows.slice(0, 12).join(', ')}… (${item.rows.length})`
                      : `l. ${item.rows.join(', ')}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── Steps ──────────────────────────────────────────────── */
// idle → validating → preview → settings → importing → done

export default function ClientImportPage() {
  const navigate  = useNavigate()
  const fileInput = useRef(null)
  const { user }  = useAuth()
  const [searchParams] = useSearchParams()

  /* Mode « repartir de zéro », ouvert depuis Paramètres → Dev Fix : la base est
     vidée juste avant l'import, dans la même requête. Réservé au super admin —
     le serveur le vérifie de son côté. */
  const resetMode = searchParams.get('reset') === '1' && user?.role === 'superadmin'
  const [resetPhrase, setResetPhrase] = useState('')
  const [wipeTodos,   setWipeTodos]   = useState(false)
  const [keepCatalog, setKeepCatalog] = useState(false)
  const resetArmed = resetPhrase.trim().toUpperCase() === RESET_PHRASE

  const [step,       setStep]       = useState('idle')
  const [file,       setFile]       = useState(null)
  const [dragOver,   setDragOver]   = useState(false)
  const [validation, setValidation] = useState(null)       // réponse de /import/validate
  const [importRes,  setImportRes]  = useState(null)       // réponse de /import/execute
  const [progress,   setProgress]   = useState(0)
  const [showMapping, setShowMapping] = useState(false)
  const [rowFilter,  setRowFilter]  = useState('all')      // all | warn | fixed | error

  /* Décisions sur les modèles de DAE, clé normalisée → décision. */
  const [decisions, setDecisions] = useState({})
  /* Regroupements de clients proposés par la lecture, clé → { on, into }. */
  const [merges, setMerges] = useState({})
  const [options, setOptions] = useState({
    createContracts:   true,
    planControls:      true,
    recordLastControl: true,
    createStockItems:  true,
    horizonMonths:     12,
  })

  const validRows = useMemo(
    () => (validation?.results || []).filter(r => r.valid).map(r => r.row),
    [validation]
  )

  const shownRows = useMemo(() => {
    const all = validation?.results || []
    if (rowFilter === 'warn')  return all.filter(r => r.warnings.length > 0)
    if (rowFilter === 'fixed') return all.filter(r => r.fixes.length > 0)
    if (rowFilter === 'error') return all.filter(r => !r.valid)
    return all
  }, [validation, rowFilter])

  const selectedMerges = useMemo(
    () => (validation?.clientGroups || [])
      .filter(g => merges[g.key]?.on)
      .map(g => ({ names: g.names, into: (merges[g.key].into || g.into).trim() || g.into })),
    [validation, merges]
  )

  /* ── Sélection du fichier ────────────────────────────── */

  function handleFiles(files) {
    const f = files[0]
    if (!f) return
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error('Seuls les fichiers .xlsx, .xls ou .csv sont acceptés.')
      return
    }
    setFile(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  /* ── 1 → 2 : lecture à blanc ─────────────────────────── */

  async function handleValidate(target = file, dateFormat) {
    if (!target) return
    setStep('validating')
    try {
      const res = await validateImport(target, { dateFormat })
      setValidation(res)
      setRowFilter('all')
      // Chaque modèle du fichier part avec la proposition du serveur : rattaché
      // s'il est déjà au catalogue, créé sinon.
      setDecisions(Object.fromEntries((res.models || []).map(m => [m.key, {
        action:     m.matched ? 'link' : 'create',
        productId:  m.matched?._id || m.suggestions?.[0]?._id || '',
        name:       m.label,
        brand:      m.suggestedBrand || '',
        deviceMode: m.suggestedMode || '',
      }])))
      setMerges(Object.fromEntries((res.clientGroups || []).map(g => [g.key, { on: g.checked, into: g.into }])))
      setStep('preview')
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la lecture du fichier.')
      setStep('idle')
    }
  }

  /* Relecture du fichier avec l'autre convention de date. */
  function switchDateFormat(order) {
    handleValidate(file, order)
  }

  /* ── 3 → 4 : import ──────────────────────────────────── */

  async function handleImport() {
    if (validRows.length === 0) return

    setStep('importing')
    setProgress(0)

    const TICK  = 120
    const timer = setInterval(() => {
      setProgress(p => (p < 88 ? p + Math.random() * 6 : p))
    }, TICK)

    const models = (validation.models || []).map(m => ({
      key: m.key, label: m.label, ...(decisions[m.key] || { action: 'create', name: m.label }),
    }))

    try {
      const res = await executeImport(validRows, {
        models,
        clientMerges: selectedMerges,
        options: resetMode
          ? { ...options, resetFirst: true, confirm: resetPhrase, wipeTodos, keepCatalog }
          : options,
      })
      clearInterval(timer)
      setProgress(100)
      setImportRes(res)
      setTimeout(() => setStep('done'), 300)
    } catch (err) {
      clearInterval(timer)
      toast.error(err.message || "Erreur lors de l'import.")
      setStep('settings')
    }
  }

  /* ── Reset ───────────────────────────────────────────── */

  function reset() {
    setStep('idle')
    setFile(null)
    setValidation(null)
    setImportRes(null)
    setDecisions({})
    setMerges({})
    setProgress(0)
    if (fileInput.current) fileInput.current.value = ''
  }

  function setDecision(key, patch) {
    setDecisions(d => ({ ...d, [key]: { ...d[key], ...patch } }))
  }

  function setMerge(key, patch) {
    setMerges(m => ({ ...m, [key]: { ...m[key], ...patch } }))
  }

  const stepIdx = { idle: 0, validating: 1, preview: 1, settings: 2, importing: 3, done: 3 }[step]
  const summary = validation?.summary
  // Regrouper deux clients en fait un de moins.
  const clientCount = summary
    ? summary.clients - selectedMerges.reduce((n, m) => n + m.names.length - 1, 0)
    : 0
  const warnGroups = (validation?.analysis || []).filter(g => g.level !== 'info')
  const infoGroups = (validation?.analysis || []).filter(g => g.level === 'info')

  /* ── Rendu ───────────────────────────────────────────── */

  return (
    <div className="page-content ci-root">

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate('/clients')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">Importer le parc</h1>
            <p className="page-subtitle">
              Clients, sites, DAE, consommables, contrats et planning des visites, depuis un fichier Excel
            </p>
          </div>
        </div>
      </div>

      {/* Step tracker */}
      <div className="ci-steps">
        {['Fichier', 'Lecture', 'Réglages', 'Résultat'].map((label, i) => {
          const done   = i < stepIdx
          const active = i === stepIdx
          return (
            <div key={label} className={`ci-step${done ? ' ci-step--done' : active ? ' ci-step--active' : ''}`}>
              <div className="ci-step-bubble">
                {done ? <Check size={13} /> : i + 1}
              </div>
              <span className="ci-step-label">{label}</span>
              {i < 3 && <div className={`ci-step-line${done ? ' ci-step-line--done' : ''}`} />}
            </div>
          )
        })}
      </div>

      <div className="ci-body">

        {resetMode && step !== 'done' && (
          <div className="ci-banner ci-banner--danger">
            <ShieldAlert size={15} />
            <span>
              <strong>Mode remise à zéro.</strong> Toutes les données métier — clients, parc,
              contrats, planning, stock, catalogue, documents — seront effacées juste avant
              l'import, puis remplacées par le contenu du fichier. Les comptes utilisateurs et
              les paramètres sont conservés. Rien n'est effacé avant le dernier clic.
            </span>
          </div>
        )}

        {/* ── ÉTAPE 1 — FICHIER ──────────────────────── */}
        {(step === 'idle' || step === 'validating') && (
          <>
            {/* Format guide */}
            <div className="ci-card">
              <div className="ci-card-header">
                <Info size={15} />
                <span>Format attendu</span>
                <button className="btn btn--ghost btn--sm ci-dl-btn" onClick={downloadSample}>
                  <Download size={13} /> Télécharger le modèle
                </button>
              </div>
              <div className="ci-card-body">
                <p className="ci-format-intro">
                  <strong>Une ligne = un DAE.</strong> Répétez le nom du client et du site
                  sur chaque ligne : les lignes sont regroupées à l'import. Seule la première
                  feuille du classeur est lue. Les colonnes absentes sont ignorées, l'ordre n'a
                  pas d'importance, et les intitulés sont reconnus même écrits autrement
                  (« N° de série », « Serial Number », « Numéro de série »). Un même appareil
                  cité sur plusieurs lignes (ventes de consommables) n'est importé qu'une fois.
                </p>
              </div>
              <div className="ci-table-wrap">
                <table className="ci-sample-table">
                  <thead>
                    {/* Bandeau de regroupement : client, site, DAE, consommables */}
                    <tr>
                      {Object.entries(
                        SAMPLE_COLUMNS.reduce((acc, c) => {
                          acc[c.group] = (acc[c.group] || 0) + 1
                          return acc
                        }, {})
                      ).map(([group, span]) => (
                        <th key={group} colSpan={span} className={`ci-group-th ci-group-th--${group}`}>
                          {GROUP_LABELS[group]}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {SAMPLE_COLUMNS.map(c => (
                        <th key={c.key}>
                          {c.label}
                          {c.required && <span className="ci-required">*</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SAMPLE_ROWS.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className={!cell ? 'ci-cell--empty' : ''}>{cell || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ci-legend">
                <span className="ci-required">*</span> Seul le nom du client est obligatoire.
                Site sans nom → « Site principal ». Dates au format jj/mm/aaaa (la convention du
                fichier est détectée et modifiable). Contrat et Pack : « oui » ou « non ».
                Les colonnes « Electrode », « Electrode RCP », « Electrode Universelle » et
                « Electrode P » portent la DLC de chaque jeu d'électrodes.
                Le <strong>dernier contrôle</strong> sert à planifier les visites suivantes.
              </p>
            </div>

            {/* Dropzone */}
            <div className="ci-card">
              <div className="ci-card-header">
                <Upload size={15} />
                <span>Sélectionner un fichier</span>
              </div>
              <div
                className={`ci-dropzone${dragOver ? ' ci-dropzone--over' : ''}${file ? ' ci-dropzone--filled' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => !file && fileInput.current?.click()}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  onChange={e => handleFiles(e.target.files)}
                />
                {file ? (
                  <div className="ci-file-selected">
                    <FileSpreadsheet size={32} className="ci-file-icon" />
                    <div className="ci-file-info">
                      <span className="ci-file-name">{file.name}</span>
                      <span className="ci-file-size">{(file.size / 1024).toFixed(1)} Ko</span>
                    </div>
                    <button
                      className="ci-file-remove"
                      onClick={e => { e.stopPropagation(); reset() }}
                      title="Retirer"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={28} className="ci-drop-icon" />
                    <p className="ci-drop-title">Glissez votre fichier ici</p>
                    <p className="ci-drop-sub">ou <span className="ci-drop-link">parcourir</span> — .xlsx, .xls, .csv</p>
                  </>
                )}
              </div>

              <div className="ci-action-row">
                <button
                  className="btn btn--primary"
                  disabled={!file || step === 'validating'}
                  onClick={() => handleValidate()}
                >
                  {step === 'validating'
                    ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Lecture…</>
                    : <><ChevronRight size={14} /> Lire le fichier</>
                  }
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── ÉTAPE 2 — LECTURE ──────────────────────── */}
        {step === 'preview' && validation && (
          <>
            {/* Ce que le fichier a donné */}
            <div className="ci-card">
              <div className="ci-preview-summary">
                <div className="ci-summary-chip ci-summary-chip--total">
                  <FileSpreadsheet size={14} />
                  <strong>{summary.total}</strong> lignes lues
                </div>
                <div className="ci-summary-chip ci-summary-chip--total">
                  <Users size={14} />
                  <strong>{summary.clients}</strong> client{summary.clients !== 1 ? 's' : ''}
                  {summary.newClients > 0 && <span className="ci-chip-new">{summary.newClients} nouveau{summary.newClients !== 1 ? 'x' : ''}</span>}
                </div>
                <div className="ci-summary-chip ci-summary-chip--total">
                  <Building2 size={14} />
                  <strong>{summary.sites}</strong> site{summary.sites !== 1 ? 's' : ''}
                  {summary.newSites > 0 && <span className="ci-chip-new">{summary.newSites} nouveau{summary.newSites !== 1 ? 'x' : ''}</span>}
                </div>
                <div className="ci-summary-chip ci-summary-chip--total">
                  <HeartPulse size={14} />
                  <strong>{summary.deas}</strong> DAE
                  {summary.deas > summary.deasWithSerial && (
                    <span className="ci-chip-sub">dont {summary.deas - summary.deasWithSerial} sans n°</span>
                  )}
                </div>
                <div className="ci-summary-chip ci-summary-chip--total">
                  <FileSignature size={14} />
                  <strong>{summary.contracts}</strong> site{summary.contracts !== 1 ? 's' : ''} sous contrat
                </div>
                {summary.invalid > 0 && (
                  <div className="ci-summary-chip ci-summary-chip--error">
                    <XCircle size={14} />
                    <strong>{summary.invalid}</strong> ligne{summary.invalid !== 1 ? 's' : ''} écartée{summary.invalid !== 1 ? 's' : ''}
                  </div>
                )}
                {summary.warnings > 0 && (
                  <div className="ci-summary-chip ci-summary-chip--warn">
                    <AlertTriangle size={14} />
                    <strong>{summary.warnings}</strong> à vérifier
                  </div>
                )}
                {summary.fixed > 0 && (
                  <div className="ci-summary-chip ci-summary-chip--info">
                    <Wand2 size={14} />
                    <strong>{summary.fixed}</strong> corrigée{summary.fixed !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              <div className="ci-card-body">
                {validation.sheetName && (
                  <p className="ci-sheet-name">
                    Feuille lue : <strong>{validation.sheetName.trim()}</strong> — les autres feuilles du classeur sont ignorées.
                  </p>
                )}

                {/* Convention de date */}
                <div className={`ci-banner${validation.dateFormat.certain ? '' : ' ci-banner--warn'}`}>
                  <Calendar size={14} />
                  <span>
                    Dates lues au format{' '}
                    <strong>{validation.dateFormat.order === 'mdy' ? 'mm/jj/aaaa' : 'jj/mm/aaaa'}</strong>
                    {validation.dateFormat.forced
                      ? ' (choisi manuellement)'
                      : validation.dateFormat.certain
                        ? ' — déduit du fichier lui-même'
                        : " — aucune date du fichier ne permet de trancher, vérifiez l'aperçu ci-dessous"}
                  </span>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => switchDateFormat(validation.dateFormat.order === 'mdy' ? 'dmy' : 'mdy')}
                  >
                    <RotateCcw size={12} /> Lire en {validation.dateFormat.order === 'mdy' ? 'jj/mm/aaaa' : 'mm/jj/aaaa'}
                  </button>
                </div>

                {/* Colonnes reconnues */}
                <button className="ci-map-toggle" onClick={() => setShowMapping(v => !v)}>
                  <Columns3 size={14} />
                  {validation.columns.filter(c => c.key).length} colonne(s) reconnue(s)
                  {summary.ignoredColumns > 0 && `, ${summary.ignoredColumns} ignorée(s)`}
                  <ChevronRight size={13} className={`ci-map-caret${showMapping ? ' ci-map-caret--open' : ''}`} />
                </button>
                {showMapping && (
                  <div className="ci-map-grid">
                    {validation.columns.filter(c => c.header).map((c, i) => (
                      <div key={i} className={`ci-map-item${c.key ? '' : ' ci-map-item--off'}`}>
                        <span className="ci-map-src">{c.header}</span>
                        <ChevronRight size={12} />
                        <span className="ci-map-dst">
                          {c.key
                            ? c.label
                            : c.ignored === 'doublon' ? 'colonne en double — ignorée' : 'non reconnue — ignorée'}
                        </span>
                        {c.match === 'approx' && <span className="ci-map-approx" title={`Rapproché de « ${c.via} »`}>≈</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Analyse du fichier */}
            {validation.analysis?.length > 0 && (
              <div className="ci-card">
                <div className="ci-card-header">
                  <ClipboardList size={15} />
                  <span>Analyse du fichier</span>
                  <button className="btn btn--ghost btn--sm ci-dl-btn" onClick={() => downloadAnalysis(validation, file?.name)}>
                    <Download size={13} /> Télécharger l'analyse (.xlsx)
                  </button>
                </div>
                <div className="ci-card-body">
                  <p className="ci-format-intro">
                    Ce que la lecture a relevé dans le fichier. Rien de tout cela n'empêche
                    l'import : les corrections sont appliquées d'office, les points « à vérifier »
                    sont importés tels quels ou ignorés, comme indiqué. Corrigez-les à la source
                    pour les prochains imports — le rapport Excel donne chaque ligne concernée.
                  </p>
                  {warnGroups.length > 0 && (
                    <>
                      <h4 className="ci-an-section">À vérifier</h4>
                      {warnGroups.map(g => <AnalysisGroup key={g.id} group={g} />)}
                    </>
                  )}
                  {infoGroups.length > 0 && (
                    <>
                      <h4 className="ci-an-section">Fait automatiquement</h4>
                      {infoGroups.map(g => <AnalysisGroup key={g.id} group={g} />)}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Détail des lignes */}
            <div className="ci-card">
              <div className="ci-card-header">
                <FileSpreadsheet size={15} />
                <span>Aperçu ligne par ligne</span>
                <select
                  className="input ci-row-filter"
                  value={rowFilter}
                  onChange={e => setRowFilter(e.target.value)}
                >
                  <option value="all">Toutes les lignes ({summary.total})</option>
                  <option value="warn">À vérifier ({summary.warnings})</option>
                  <option value="fixed">Corrigées ({summary.fixed})</option>
                  {summary.invalid > 0 && <option value="error">Écartées ({summary.invalid})</option>}
                </select>
              </div>
              <div className="ci-table-wrap">
                <table className="ci-preview-table">
                  <thead>
                    <tr>
                      <th style={{ width: 46 }}>Ligne</th>
                      <th>Client</th>
                      <th>Site</th>
                      <th>DAE</th>
                      <th>Emplacement</th>
                      <th>Pose</th>
                      <th>Dernier contrôle</th>
                      <th>Consommables</th>
                      <th style={{ width: 60 }}>Statut</th>
                      <th>Remarques</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map(r => (
                      <tr key={r.rowNum} className={r.valid ? '' : 'ci-row--error'}>
                        <td className="ci-row-num">{r.rowNum}</td>
                        <td className="ci-cell-name">
                          {r.clientName || <em className="ci-cell--empty">—</em>}
                          {r.clientName && (
                            <div className="ci-cell-sub">
                              {r.clientExists ? 'client existant' : 'nouveau client'}
                            </div>
                          )}
                        </td>
                        <td>
                          {r.siteName}
                          <div className="ci-cell-sub">
                            {[r.siteExists ? 'site existant' : 'nouveau site', r.row.siteContactName]
                              .filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td>
                          {r.hasDea ? (
                            <>
                              {r.row.deaType || <em className="ci-cell--empty">modèle ?</em>}
                              {r.row.deaSerial && <div className="ci-cell-sub">{r.row.deaSerial}</div>}
                            </>
                          ) : <em className="ci-cell--empty">—</em>}
                        </td>
                        <td>{r.row.deaLocation || <em className="ci-cell--empty">—</em>}</td>
                        <td>{r.row.deaInstallDate || <em className="ci-cell--empty">—</em>}</td>
                        <td>
                          {r.row.deaLastControl || <em className="ci-cell--empty">—</em>}
                          {r.row.deaNextControl && <div className="ci-cell-sub">prochain : {r.row.deaNextControl}</div>}
                        </td>
                        <td><ConsumablesCell row={r.row} /></td>
                        <td>
                          {r.valid
                            ? <span className="ci-status ci-status--ok"><CheckCircle2 size={14} /></span>
                            : <span className="ci-status ci-status--error"><XCircle size={14} /></span>
                          }
                        </td>
                        <td>
                          {r.errors.length > 0 && (
                            <ul className="ci-error-list">
                              {r.errors.map((e, j) => <li key={j}>{e}</li>)}
                            </ul>
                          )}
                          {r.warnings?.length > 0 && (
                            <ul className="ci-error-list ci-warn-list">
                              {r.warnings.map((w, j) => <li key={j}>{w}</li>)}
                            </ul>
                          )}
                          {r.fixes?.length > 0 && (
                            <ul className="ci-error-list ci-fix-list">
                              {r.fixes.map((f, j) => <li key={j}>{f}</li>)}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {summary.invalid > 0 && (
                <div className="ci-warning-banner">
                  <AlertTriangle size={14} />
                  Les {summary.invalid} ligne{summary.invalid !== 1 ? 's' : ''} écartée{summary.invalid !== 1 ? 's' : ''} n'ont
                  pas de nom de client : complétez-les dans le fichier et relancez la lecture pour les rattraper.
                  Les {summary.valid} autres s'importent normalement.
                </div>
              )}

              <div className="ci-action-row">
                <button className="btn btn--ghost" onClick={reset}>
                  <RotateCcw size={13} /> Changer de fichier
                </button>
                <button
                  className="btn btn--primary"
                  disabled={summary.valid === 0}
                  onClick={() => setStep('settings')}
                >
                  <ChevronRight size={14} /> Continuer
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── ÉTAPE 3 — RÉGLAGES ─────────────────────── */}
        {step === 'settings' && validation && (
          <>
            {/* Clients à regrouper */}
            {validation.clientGroups?.length > 0 && (
              <div className="ci-card">
                <div className="ci-card-header">
                  <GitMerge size={15} />
                  <span>Clients à regrouper ({validation.clientGroups.length})</span>
                </div>
                <div className="ci-card-body">
                  <p className="ci-format-intro">
                    Ces noms désignent peut-être le même client : même contact, même domaine
                    email, un nom qui contient l'autre. Cochez ceux à réunir sous un seul client —
                    leurs sites s'y rangent. Les regroupements les plus sûrs sont cochés d'office.
                  </p>
                  {validation.clientGroups.map(g => {
                    const m = merges[g.key] || {}
                    return (
                      <div key={g.key} className={`ci-merge${m.on ? ' ci-merge--on' : ''}`}>
                        <label className="ci-merge-head">
                          <input
                            type="checkbox"
                            checked={!!m.on}
                            onChange={e => setMerge(g.key, { on: e.target.checked })}
                          />
                          <span className="ci-merge-names">{g.names.join(' · ')}</span>
                          <span className="ci-model-count">{g.rows} ligne{g.rows > 1 ? 's' : ''}</span>
                        </label>
                        <div className="ci-merge-reasons">{g.reasons.join(' — ')}</div>
                        {m.on && (
                          <div className="ci-choice-fields">
                            <label>
                              Nom du client regroupé
                              <input
                                className="input"
                                list={`merge-${g.key}`}
                                value={m.into ?? g.into}
                                onChange={e => setMerge(g.key, { into: e.target.value })}
                              />
                              <datalist id={`merge-${g.key}`}>
                                {g.names.map(n => <option key={n} value={n} />)}
                              </datalist>
                            </label>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Modèles de DAE */}
            {validation.models.length > 0 && (
              <div className="ci-card">
                <div className="ci-card-header">
                  <Package size={15} />
                  <span>Modèles de DAE ({validation.models.length})</span>
                </div>
                <div className="ci-card-body">
                  <p className="ci-format-intro">
                    Chaque modèle cité dans le fichier doit correspondre à un produit du catalogue
                    pour que le parc, le stock et les consommables se rejoignent. Les libellés ont
                    été harmonisés (« POWERHEAR G5 » → « Powerheart G5 »). Les modèles déjà connus
                    sont rattachés automatiquement ; pour les autres, choisissez.
                  </p>
                  {resetMode && !keepCatalog && (
                    <div className="ci-banner">
                      <Info size={14} />
                      <span>
                        Le catalogue est vidé avec le reste : un modèle « rattaché » à un produit
                        existant sera recréé sous le nom indiqué. Pour le garder, cochez
                        « Conserver le catalogue » plus bas.
                      </span>
                    </div>
                  )}

                  {validation.models.map(m => {
                    const d = decisions[m.key] || {}
                    return (
                      <div key={m.key} className="ci-model">
                        <div className="ci-model-head">
                          <span className="ci-model-label">{m.label}</span>
                          <span className="ci-model-count">
                            {m.count} DAE · ligne{m.rows.length !== 1 ? 's' : ''} {m.rows.join(', ')}
                          </span>
                          {m.matched
                            ? <span className="ci-model-badge ci-model-badge--ok"><CheckCircle2 size={12} /> au catalogue</span>
                            : <span className="ci-model-badge ci-model-badge--new"><Sparkles size={12} /> inconnu</span>}
                        </div>

                        <div className="ci-model-choices">
                          {/* Créer */}
                          <label className={`ci-choice${d.action === 'create' ? ' ci-choice--on' : ''}`}>
                            <input
                              type="radio"
                              name={`m-${m.key}`}
                              checked={d.action === 'create'}
                              onChange={() => setDecision(m.key, { action: 'create' })}
                            />
                            <Sparkles size={13} />
                            <span>Créer le modèle au catalogue</span>
                          </label>
                          {d.action === 'create' && (
                            <div className="ci-choice-fields">
                              <label>
                                Nom
                                <input
                                  className="input"
                                  value={d.name ?? m.label}
                                  onChange={e => setDecision(m.key, { name: e.target.value })}
                                />
                              </label>
                              <label>
                                Marque
                                <input
                                  className="input"
                                  placeholder="optionnel"
                                  value={d.brand ?? ''}
                                  onChange={e => setDecision(m.key, { brand: e.target.value })}
                                />
                              </label>
                              <label>
                                Référence
                                <input
                                  className="input"
                                  placeholder="optionnel"
                                  value={d.reference ?? ''}
                                  onChange={e => setDecision(m.key, { reference: e.target.value })}
                                />
                              </label>
                              <label>
                                Mode
                                <select
                                  className="input"
                                  value={d.deviceMode ?? ''}
                                  onChange={e => setDecision(m.key, { deviceMode: e.target.value })}
                                >
                                  <option value="">—</option>
                                  <option value="automatique">Automatique</option>
                                  <option value="semi-automatique">Semi-automatique</option>
                                </select>
                              </label>
                            </div>
                          )}

                          {/* Rattacher */}
                          <label className={`ci-choice${d.action === 'link' ? ' ci-choice--on' : ''}`}>
                            <input
                              type="radio"
                              name={`m-${m.key}`}
                              checked={d.action === 'link'}
                              onChange={() => setDecision(m.key, {
                                action: 'link',
                                productId: d.productId || m.matched?._id || m.suggestions?.[0]?._id || '',
                              })}
                            />
                            <Link2 size={13} />
                            <span>Rattacher à un modèle existant</span>
                          </label>
                          {d.action === 'link' && (
                            <div className="ci-choice-fields">
                              <select
                                className="input"
                                value={d.productId || ''}
                                onChange={e => setDecision(m.key, { productId: e.target.value })}
                              >
                                <option value="">— choisir un modèle —</option>
                                {m.suggestions.length > 0 && (
                                  <optgroup label="Les plus proches">
                                    {m.suggestions.map(s => (
                                      <option key={s._id} value={s._id}>
                                        {s.name}{s.brand ? ` — ${s.brand}` : ''} ({Math.round(s.score * 100)} %)
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="Tout le catalogue défibrillateurs">
                                  {validation.catalog.map(p => (
                                    <option key={p._id} value={p._id}>
                                      {p.name}{p.brand ? ` — ${p.brand}` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                          )}

                          {/* Ignorer */}
                          <label className={`ci-choice${d.action === 'skip' ? ' ci-choice--on' : ''}`}>
                            <input
                              type="radio"
                              name={`m-${m.key}`}
                              checked={d.action === 'skip'}
                              onChange={() => setDecision(m.key, { action: 'skip' })}
                            />
                            <Ban size={13} />
                            <span>Ne rien rattacher — le DAE gardera « {m.label} » comme libellé</span>
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Options d'import */}
            <div className="ci-card">
              <div className="ci-card-header">
                <CalendarClock size={15} />
                <span>Ce que l'import doit faire</span>
              </div>

              <div className="ci-card-body">
                <label className="ci-opt">
                  <input
                    type="checkbox"
                    checked={options.createContracts}
                    onChange={e => setOptions(o => ({ ...o, createContracts: e.target.checked }))}
                  />
                  <span>
                    <strong>Créer un contrat de maintenance par site sous contrat</strong>
                    <em>
                      Pour chaque site marqué « Contrat : oui » ({summary.contracts} site{summary.contracts !== 1 ? 's' : ''}) :
                      un contrat actif, numéroté à la suite, sans dates ni forfait si le fichier
                      ne les donne pas — à compléter ensuite depuis la fiche du contrat. Le client
                      passe « sous contrat ». Un site signalé fermé n'en reçoit pas.
                    </em>
                  </span>
                </label>

                <label className="ci-opt">
                  <input
                    type="checkbox"
                    checked={options.planControls}
                    onChange={e => setOptions(o => ({ ...o, planControls: e.target.checked }))}
                  />
                  <span>
                    <strong>Planifier les prochaines visites des sites sous contrat</strong>
                    <em>
                      Une visite tous les six mois à partir du dernier contrôle déclaré (à défaut,
                      de la date de pose), une sur deux valant contrôle annuel. Les visites déjà
                      passées ne sont pas recréées, et une date de « prochain contrôle » présente
                      dans le fichier fait foi.
                    </em>
                  </span>
                </label>

                {options.planControls && (
                  <label className="ci-opt ci-opt--sub">
                    <span>Planifier sur</span>
                    <select
                      className="input"
                      value={options.horizonMonths}
                      onChange={e => setOptions(o => ({ ...o, horizonMonths: Number(e.target.value) }))}
                    >
                      <option value={6}>les 6 prochains mois</option>
                      <option value={12}>les 12 prochains mois</option>
                      <option value={24}>les 24 prochains mois</option>
                    </select>
                  </label>
                )}

                <label className="ci-opt">
                  <input
                    type="checkbox"
                    checked={options.recordLastControl}
                    onChange={e => setOptions(o => ({ ...o, recordLastControl: e.target.checked }))}
                  />
                  <span>
                    <strong>Consigner le dernier contrôle comme visite faite</strong>
                    <em>
                      Le site garde ainsi la trace de sa dernière visite dans l'historique des
                      interventions — « hors contrat » pour les sites sans contrat.
                    </em>
                  </span>
                </label>

                <label className="ci-opt">
                  <input
                    type="checkbox"
                    checked={options.createStockItems}
                    onChange={e => setOptions(o => ({ ...o, createStockItems: e.target.checked }))}
                  />
                  <span>
                    <strong>Créer les exemplaires manquants dans le stock</strong>
                    <em>
                      Chaque DAE avec un n° de série et un modèle rattaché devient un exemplaire
                      marqué « installé » chez le client. Sans cela, l'appareil vit dans le parc mais
                      reste absent de l'inventaire.
                    </em>
                  </span>
                </label>
              </div>

              {resetMode && (
                <div className="ci-card-body ci-reset-confirm">
                  <label className="sp-reset-opt">
                    <input type="checkbox" checked={wipeTodos}
                      onChange={e => setWipeTodos(e.target.checked)} />
                    <span>Vider aussi le Suivi des demandes (évolutions et correctifs échangés
                      avec CardioLife). Sans cette case, il est conservé.</span>
                  </label>
                  <label className="sp-reset-opt">
                    <input type="checkbox" checked={keepCatalog}
                      onChange={e => setKeepCatalog(e.target.checked)} />
                    <span>Conserver le catalogue produits (modèles, images, fiches du site web).
                      Sans cette case, il est vidé et seuls les modèles de DAE du fichier sont
                      recréés ; le stock repart à zéro dans les deux cas.</span>
                  </label>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">
                      Tapez <strong>{RESET_PHRASE}</strong> pour vider la base et importer
                    </label>
                    <input className="form-input form-input--plain" value={resetPhrase}
                      onChange={e => setResetPhrase(e.target.value)}
                      placeholder={RESET_PHRASE} autoComplete="off" />
                  </div>
                </div>
              )}

              <div className="ci-action-row">
                <button className="btn btn--ghost" onClick={() => setStep('preview')}>
                  <ArrowLeft size={13} /> Revenir à l'aperçu
                </button>
                <button className={`btn ${resetMode ? 'btn--danger' : 'btn--primary'}`}
                  onClick={handleImport} disabled={resetMode && !resetArmed}>
                  <Upload size={14} />
                  {resetMode ? 'Vider la base et importer ' : 'Importer '}
                  {clientCount} client{clientCount !== 1 ? 's' : ''}
                  {' · '}{summary.deas} DAE
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── IMPORT EN COURS ────────────────────────── */}
        {step === 'importing' && (
          <div className="ci-card ci-card--center">
            <FileSpreadsheet size={48} className="ci-importing-icon" />
            <p className="ci-importing-title">Import en cours…</p>
            <p className="ci-importing-sub">
              {clientCount} client{clientCount !== 1 ? 's' : ''}
              {summary.deas > 0 && `, ${summary.deas} DAE`}
              {options.createContracts && ', les contrats'}
              {resetMode && ' — après remise à zéro de la base'}
              {options.planControls && ' et le planning des visites'}
            </p>
            <div className="ci-progress-wrap">
              <div className="ci-progress-bar">
                <div className="ci-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="ci-progress-pct">{Math.round(progress)}%</span>
            </div>
          </div>
        )}

        {/* ── RÉSULTAT ───────────────────────────────── */}
        {step === 'done' && importRes && (
          <div className="ci-card">
            <div className="ci-done-header">
              <div className={`ci-done-icon${importRes.summary.failed === 0 ? ' ci-done-icon--success' : ' ci-done-icon--partial'}`}>
                {importRes.summary.failed === 0
                  ? <CheckCircle2 size={32} />
                  : <AlertTriangle size={32} />
                }
              </div>
              <div>
                <p className="ci-done-title">
                  {importRes.summary.failed === 0 ? 'Import réussi !' : 'Import terminé avec des erreurs'}
                </p>
                <p className="ci-done-sub">
                  {importRes.summary.imported} client{importRes.summary.imported !== 1 ? 's' : ''} traité{importRes.summary.imported !== 1 ? 's' : ''}
                  {` (${importRes.summary.created} créé${importRes.summary.created !== 1 ? 's' : ''}, ${importRes.summary.updated || 0} mis à jour)`}
                  {importRes.summary.failed > 0 && `, ${importRes.summary.failed} échec${importRes.summary.failed !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>

            <div className="ci-preview-summary">
              <div className="ci-summary-chip ci-summary-chip--total">
                <Building2 size={14} /><strong>{importRes.summary.sitesCreated || 0}</strong> site(s) créé(s)
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <HeartPulse size={14} /><strong>{importRes.summary.deasCreated || 0}</strong> DAE ajouté(s)
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <RotateCcw size={14} /><strong>{importRes.summary.deasUpdated || 0}</strong> DAE mis à jour
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <FileSignature size={14} /><strong>{importRes.summary.contractsCreated || 0}</strong> contrat(s) créé(s)
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <Package size={14} /><strong>{importRes.summary.itemsCreated || 0}</strong> exemplaire(s) au stock
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <CalendarClock size={14} /><strong>{importRes.summary.controlsPlanned || 0}</strong> visite(s) planifiée(s)
                {importRes.summary.controlsHistory > 0 && (
                  <span className="ci-chip-sub">+ {importRes.summary.controlsHistory} dernier(s) contrôle(s) consigné(s)</span>
                )}
              </div>
              {importRes.summary.modelsCreated > 0 && (
                <div className="ci-summary-chip ci-summary-chip--total">
                  <Sparkles size={14} /><strong>{importRes.summary.modelsCreated}</strong> modèle(s) créé(s)
                </div>
              )}
            </div>

            {importRes.reset && (
              <div className="ci-card-body">
                <div className="ci-banner ci-banner--warn">
                  <ShieldAlert size={14} />
                  <span>
                    Base vidée avant l'import :{' '}
                    {Object.values(importRes.reset).reduce((n, v) => n + v, 0)} enregistrement(s) supprimé(s),
                    comptes et paramètres conservés.
                  </span>
                </div>
              </div>
            )}

            {importRes.modelsCreated?.length > 0 && (
              <div className="ci-card-body">
                <div className="ci-banner">
                  <Sparkles size={14} />
                  <span>
                    Nouveaux modèles au catalogue : {importRes.modelsCreated.map(m => m.name).join(', ')}.
                    Complétez leur fiche (référence, prix, visuel) depuis le stock.
                  </span>
                </div>
              </div>
            )}

            <div className="ci-table-wrap">
              <table className="ci-preview-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Statut</th>
                    <th>Sites</th>
                    <th>DAE</th>
                    <th>Contrats</th>
                    <th>Visites</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {importRes.results.map((r, i) => (
                    <tr key={i} className={r.success ? '' : 'ci-row--error'}>
                      <td className="ci-cell-name">{r.name}</td>
                      <td>
                        {r.success
                          ? <span className="ci-status ci-status--ok"><CheckCircle2 size={14} /> {r.action === 'updated' ? 'Mis à jour' : 'Créé'}</span>
                          : <span className="ci-status ci-status--error"><XCircle size={14} /> Échec</span>
                        }
                      </td>
                      <td>
                        {r.success
                          ? `${r.sites} (${r.sitesCreated} créé${r.sitesCreated !== 1 ? 's' : ''})`
                          : <em className="ci-cell--empty">—</em>}
                      </td>
                      <td>
                        {r.success
                          ? (r.deasCreated || r.deasUpdated
                              ? `${r.deasCreated} ajouté${r.deasCreated !== 1 ? 's' : ''}, ${r.deasUpdated} mis à jour`
                              : <em className="ci-cell--empty">—</em>)
                          : <em className="ci-cell--empty">—</em>}
                      </td>
                      <td>{r.success && r.contractsCreated ? r.contractsCreated : <em className="ci-cell--empty">—</em>}</td>
                      <td>
                        {r.success
                          ? (r.controlsPlanned || r.controlsHistory
                              ? `${r.controlsPlanned} planifiée${r.controlsPlanned !== 1 ? 's' : ''}${r.controlsHistory ? `, ${r.controlsHistory} reprise${r.controlsHistory !== 1 ? 's' : ''}` : ''}`
                              : <em className="ci-cell--empty">—</em>)
                          : <em className="ci-cell--empty">—</em>}
                      </td>
                      <td>
                        {r.error && <span className="ci-error-inline">{r.error}</span>}
                        {r.notes?.length > 0 && (
                          <ul className="ci-error-list ci-warn-list">
                            {r.notes.map((n, j) => <li key={j}>{n}</li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ci-action-row">
              <button className="btn btn--ghost" onClick={reset}>
                <RotateCcw size={13} /> Nouvel import
              </button>
              <button className="btn btn--primary" onClick={() => navigate('/clients')}>
                <Users size={14} /> Voir les clients
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
