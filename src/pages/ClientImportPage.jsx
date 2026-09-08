import { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  ArrowLeft, Upload, Download, FileSpreadsheet, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, RotateCcw, Check,
  Users, Info, Building2, HeartPulse, Columns3, CalendarClock,
  Package, Sparkles, Link2, Ban, Calendar,
} from 'lucide-react'
import { validateImport, executeImport } from '../api/clients'
import { toast } from 'react-toastify'

/* ── Modèle de fichier ───────────────────────────────────────
   Une ligne = un DAE. Les colonnes client et site se répètent d'une ligne à
   l'autre ; les lignes sont regroupées à l'import. Une ligne sans colonne DAE
   crée simplement le client et son site. */

const SAMPLE_COLUMNS = [
  // Client
  { key: 'Client',              group: 'client', label: 'Client', required: true },
  { key: 'Contrat',             group: 'client', label: 'Sous contrat' },
  // Site
  { key: 'Nom du site',         group: 'site', label: 'Nom du site' },
  { key: 'Adresse',             group: 'site', label: 'Adresse' },
  { key: 'Ville',               group: 'site', label: 'Ville' },
  { key: 'Gouvernorat',         group: 'site', label: 'Gouvernorat' },
  { key: 'Responsable du site', group: 'site', label: 'Responsable' },
  { key: 'Num de téléphone',    group: 'site', label: 'Téléphone' },
  { key: 'Email',               group: 'site', label: 'Email' },
  // DAE
  { key: 'Type DEA',            group: 'dae', label: 'Modèle' },
  { key: 'Serial Number',       group: 'dae', label: 'N° de série' },
  { key: 'Emplacement',         group: 'dae', label: 'Emplacement' },
  { key: "Date d'installation", group: 'dae', label: 'Date de pose' },
  { key: 'Dernier contrôle',    group: 'dae', label: 'Dernier contrôle' },
  { key: 'Type de contrôle',    group: 'dae', label: 'Périodicité' },
  // Consommables
  { key: 'Batterie DLC',        group: 'conso', label: 'DLC batterie' },
  { key: 'Batterie charge',     group: 'conso', label: 'Charge batterie' },
  { key: 'DLC Electrodes',      group: 'conso', label: 'DLC électrodes' },
  { key: 'Electrodes type',     group: 'conso', label: 'Type électrodes' },
]

const GROUP_LABELS = {
  client: 'Client',
  site:   'Site',
  dae:    'DAE',
  conso:  'Consommables',
}

const SAMPLE_ROWS = [
  ['Clinique El Amel', 'oui',
   'Bloc A', '12 Av. Habib Bourguiba', 'Tunis', 'Tunis', 'Salah Mabrouk', '71 100 201', 'bloc.a@elamel.tn',
   'POWERHEART G5', 'D00000096721', "Hall d'entrée", '12/03/2024', '01/08/2026', 'semestriel',
   '31/01/2029', '95%', '30/11/2027', 'adulte'],
  // Même client, même site : seul le DAE change
  ['Clinique El Amel', 'oui',
   'Bloc A', '', '', '', '', '', '',
   'POWERHEART G5', 'D00000096722', 'Étage 2 — couloir', '15/04/2024', '01/08/2026', 'semestriel',
   '31/01/2029', '90%', '30/11/2027', 'enfant'],
  // Deuxième site du même client, encore sans DAE posé
  ['Clinique El Amel', 'oui',
   'Annexe La Marsa', '3 Rue du Lac', 'La Marsa', 'Tunis', 'Nadia Karray', '71 100 202', '',
   '', '', '', '', '', '', '', '', '', ''],
  ['Mairie de Sfax', 'non',
   'Hôtel de ville', 'Place de la Liberté', 'Sfax', 'Sfax', 'Anis Trabelsi', '74 200 300', '',
   'ZOLL AED 3', 'X21G123456', 'Accueil', '02/09/2023', '15/06/2026', 'annuel',
   '31/08/2028', '80%', '31/08/2027', 'adulte'],
]

function downloadSample() {
  const ws = XLSX.utils.aoa_to_sheet([
    SAMPLE_COLUMNS.map(c => c.key),
    ...SAMPLE_ROWS,
  ])

  ws['!cols'] = SAMPLE_COLUMNS.map(() => ({ wch: 22 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Parc')
  XLSX.writeFile(wb, 'modele_import_parc.xlsx')
}

/* Batterie et électrodes d'une ligne, résumées pour l'aperçu. */
function ConsumablesCell({ row }) {
  const lines = []
  if (row.battSerial || row.battExpiry || row.battLevel) {
    lines.push(`Batt. ${[row.battSerial, row.battExpiry, row.battLevel && `${row.battLevel} %`]
      .filter(Boolean).join(' · ')}`)
  }
  if (row.elecKind || row.elecLot || row.elecExpiry) {
    lines.push(`Élec. ${[row.elecKind, row.elecLot, row.elecExpiry].filter(Boolean).join(' · ')}`)
  }
  if (lines.length === 0) return <em className="ci-cell--empty">—</em>
  return lines.map((line, i) => <div key={i}>{line}</div>)
}

/* ── Steps ──────────────────────────────────────────────── */
// idle → validating → preview → settings → importing → done

export default function ClientImportPage() {
  const navigate  = useNavigate()
  const fileInput = useRef(null)

  const [step,       setStep]       = useState('idle')
  const [file,       setFile]       = useState(null)
  const [dragOver,   setDragOver]   = useState(false)
  const [validation, setValidation] = useState(null)       // réponse de /import/validate
  const [importRes,  setImportRes]  = useState(null)       // réponse de /import/execute
  const [progress,   setProgress]   = useState(0)
  const [showMapping, setShowMapping] = useState(false)

  /* Décisions sur les modèles de DAE, clé normalisée → décision. */
  const [decisions, setDecisions] = useState({})
  const [options, setOptions] = useState({
    planControls:      true,
    recordLastControl: true,
    createStockItems:  true,
    horizonMonths:     12,
  })

  const validRows = useMemo(
    () => (validation?.results || []).filter(r => r.valid).map(r => r.row),
    [validation]
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
      // Chaque modèle du fichier part avec la proposition du serveur : rattaché
      // s'il est déjà au catalogue, créé sinon.
      setDecisions(Object.fromEntries((res.models || []).map(m => [m.key, {
        action:    m.matched ? 'link' : 'create',
        productId: m.matched?._id || m.suggestions?.[0]?._id || '',
        name:      m.label,
        brand:     m.suggestedBrand || '',
      }])))
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
      const res = await executeImport(validRows, { models, options })
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
    setProgress(0)
    if (fileInput.current) fileInput.current.value = ''
  }

  function setDecision(key, patch) {
    setDecisions(d => ({ ...d, [key]: { ...d[key], ...patch } }))
  }

  const stepIdx = { idle: 0, validating: 1, preview: 1, settings: 2, importing: 3, done: 3 }[step]
  const summary = validation?.summary

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
              Clients, sites, DAE, consommables et planning des visites, depuis un fichier Excel
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
              <p className="ci-format-intro">
                <strong>Une ligne = un DAE.</strong> Répétez le nom du client et du site
                sur chaque ligne : les lignes sont regroupées à l'import. Une ligne sans
                colonne DAE crée simplement le client et son site. Les colonnes absentes
                sont ignorées, l'ordre n'a pas d'importance, et les intitulés sont reconnus
                même écrits autrement (« N° de série », « Serial Number », « Numéro de série »).
              </p>
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
                fichier est détectée et modifiable). Contrat : « oui » ou « non ».
                Contrôle : « semestriel » ou « annuel ». Électrodes : « adulte » ou « enfant ».
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
                <div className="ci-summary-chip ci-summary-chip--ok">
                  <CheckCircle2 size={14} />
                  <strong>{summary.valid}</strong> valide{summary.valid !== 1 ? 's' : ''}
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
                </div>
                {summary.invalid > 0 && (
                  <div className="ci-summary-chip ci-summary-chip--error">
                    <XCircle size={14} />
                    <strong>{summary.invalid}</strong> ligne{summary.invalid !== 1 ? 's' : ''} en erreur
                  </div>
                )}
                {summary.warnings > 0 && (
                  <div className="ci-summary-chip ci-summary-chip--warn">
                    <AlertTriangle size={14} />
                    <strong>{summary.warnings}</strong> à vérifier
                  </div>
                )}
              </div>

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

            {/* Détail des lignes */}
            <div className="ci-card">
              <div className="ci-card-header">
                <FileSpreadsheet size={15} />
                <span>Aperçu ligne par ligne</span>
              </div>
              <div className="ci-table-wrap">
                <table className="ci-preview-table">
                  <thead>
                    <tr>
                      <th style={{ width: 46 }}>#</th>
                      <th>Client</th>
                      <th>Site</th>
                      <th>DAE</th>
                      <th>Emplacement</th>
                      <th>Pose</th>
                      <th>Dernier contrôle</th>
                      <th>Consommables</th>
                      <th style={{ width: 60 }}>Statut</th>
                      <th>À vérifier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.results.map((r, i) => (
                      <tr key={i} className={r.valid ? '' : 'ci-row--error'}>
                        <td className="ci-row-num">{r.rowNum}</td>
                        <td className="ci-cell-name">
                          {r.row.name || <em className="ci-cell--empty">—</em>}
                          {r.row.name && (
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {summary.invalid > 0 && (
                <div className="ci-warning-banner">
                  <AlertTriangle size={14} />
                  Les {summary.invalid} ligne{summary.invalid !== 1 ? 's' : ''} en erreur seront ignorées :
                  corrigez-les dans le fichier et relancez la lecture pour les rattraper.
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
            {/* Modèles de DAE */}
            {validation.models.length > 0 && (
              <div className="ci-card">
                <div className="ci-card-header">
                  <Package size={15} />
                  <span>Modèles de DAE ({validation.models.length})</span>
                </div>
                <p className="ci-format-intro">
                  Chaque modèle cité dans le fichier doit correspondre à un produit du catalogue
                  pour que le parc, le stock et les consommables se rejoignent. Les modèles déjà
                  connus sont rattachés automatiquement ; pour les autres, choisissez.
                </p>

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
            )}

            {/* Options d'import */}
            <div className="ci-card">
              <div className="ci-card-header">
                <CalendarClock size={15} />
                <span>Ce que l'import doit faire</span>
              </div>

              <label className="ci-opt">
                <input
                  type="checkbox"
                  checked={options.planControls}
                  onChange={e => setOptions(o => ({ ...o, planControls: e.target.checked }))}
                />
                <span>
                  <strong>Planifier les prochaines visites</strong>
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
                  <em>Le site garde ainsi la trace de sa dernière visite dans l'historique des interventions.</em>
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

              <div className="ci-banner">
                <Info size={14} />
                <span>
                  L'import ne crée pas de contrat : la case « Contrat » du fichier marque
                  simplement le client comme étant sous contrat. Le contrat lui-même se
                  crée depuis la fiche du site, avec son numéro et ses dates.
                </span>
              </div>

              <div className="ci-action-row">
                <button className="btn btn--ghost" onClick={() => setStep('preview')}>
                  <ArrowLeft size={13} /> Revenir à l'aperçu
                </button>
                <button className="btn btn--primary" onClick={handleImport}>
                  <Upload size={14} />
                  Importer {summary.clients} client{summary.clients !== 1 ? 's' : ''}
                  {' · '}{summary.sites} site{summary.sites !== 1 ? 's' : ''}
                  {summary.deas > 0 && ` · ${summary.deas} DAE`}
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
              {summary.clients} client{summary.clients !== 1 ? 's' : ''},
              {' '}{summary.sites} site{summary.sites !== 1 ? 's' : ''}
              {summary.deas > 0 && `, ${summary.deas} DAE`}
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
                <Package size={14} /><strong>{importRes.summary.itemsCreated || 0}</strong> exemplaire(s) au stock
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <CalendarClock size={14} /><strong>{importRes.summary.controlsPlanned || 0}</strong> visite(s) planifiée(s)
              </div>
              {importRes.summary.modelsCreated > 0 && (
                <div className="ci-summary-chip ci-summary-chip--total">
                  <Sparkles size={14} /><strong>{importRes.summary.modelsCreated}</strong> modèle(s) créé(s)
                </div>
              )}
            </div>

            {importRes.modelsCreated?.length > 0 && (
              <div className="ci-banner">
                <Sparkles size={14} />
                <span>
                  Nouveaux modèles au catalogue : {importRes.modelsCreated.map(m => m.name).join(', ')}.
                  Complétez leur fiche (référence, prix, visuel) depuis le stock.
                </span>
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
