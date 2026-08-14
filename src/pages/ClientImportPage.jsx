import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  ArrowLeft, Upload, Download, FileSpreadsheet, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, RotateCcw, Check,
  Users, Info, Building2, HeartPulse,
} from 'lucide-react'
import { validateImport, executeImport } from '../api/clients'
import { toast } from 'react-toastify'

/* ── Modèle de fichier ───────────────────────────────────────
   Une ligne = un DAE. Les colonnes client et site se répètent d'une ligne à
   l'autre ; les lignes sont regroupées à l'import. Une ligne sans colonne DAE
   crée simplement le client et son site. */

const SAMPLE_COLUMNS = [
  // Client
  { key: 'nom',                       group: 'client', label: 'Nom du client', required: true },
  { key: 'client ville',              group: 'client', label: 'Ville' },
  { key: 'sous contrat',              group: 'client', label: 'Sous contrat' },
  { key: 'notes',                     group: 'client', label: 'Notes' },
  // Site
  { key: 'site',                      group: 'site', label: 'Nom du site' },
  { key: 'site adresse',              group: 'site', label: 'Adresse' },
  { key: 'site ville',                group: 'site', label: 'Ville' },
  { key: 'responsable',               group: 'site', label: 'Responsable' },
  { key: 'responsable téléphone',     group: 'site', label: 'Resp. tél.' },
  { key: 'responsable email',         group: 'site', label: 'Resp. email' },
  // DAE
  { key: 'DAE type',                  group: 'dae', label: 'Type / modèle' },
  { key: 'DAE numéro de série',       group: 'dae', label: 'N° de série' },
  { key: 'DAE emplacement',           group: 'dae', label: 'Emplacement' },
  { key: 'DAE date installation',     group: 'dae', label: 'Date de pose' },
  { key: 'DAE statut',                group: 'dae', label: 'Statut' },
  { key: 'DAE type de contrôle',      group: 'dae', label: 'Type de contrôle' },
  { key: 'DAE prochain contrôle',     group: 'dae', label: 'Prochain contrôle' },
  // Consommables
  { key: 'batterie numéro de série',  group: 'conso', label: 'Batterie n° série' },
  { key: 'batterie date expiration',  group: 'conso', label: 'Batterie expiration' },
  { key: 'batterie niveau',           group: 'conso', label: 'Batterie niveau %' },
  { key: 'électrodes type',           group: 'conso', label: 'Électrodes type' },
  { key: 'électrodes lot',            group: 'conso', label: 'Électrodes lot' },
  { key: 'électrodes date expiration', group: 'conso', label: 'Électrodes expiration' },
]

const GROUP_LABELS = {
  client: 'Client',
  site:   'Site',
  dae:    'DAE',
  conso:  'Consommables',
}

const SAMPLE_ROWS = [
  ['Clinique El Amel', 'Tunis', 'oui', 'Contrat prioritaire',
   'Bloc A', '12 Av. Habib Bourguiba', 'Tunis', 'Salah Mabrouk', '+216 71 100 201', 'bloc.a@elamel.tn',
   'Zoll AED 3', 'SN-A-001', "Hall d'entrée", '12/03/2024', 'installé', 'semestriel', '12/03/2026',
   'BAT-2024-11', '31/01/2027', '92', 'adulte', 'LOT-77', '30/11/2026'],
  // Même client, même site : seul le DAE change
  ['Clinique El Amel', '', '', '',
   'Bloc A', '', '', '', '', '',
   'Zoll AED 3', 'SN-A-002', 'Étage 2 — couloir', '15/04/2024', 'installé', 'semestriel', '15/04/2026',
   '', '', '', 'enfant', 'LOT-78', '30/11/2026'],
  // Deuxième site du même client, encore sans DAE posé
  ['Clinique El Amel', '', '', '',
   'Annexe La Marsa', '3 Rue du Lac', 'La Marsa', 'Nadia Karray', '+216 71 100 202', '',
   '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Mairie de Sfax', 'Sfax', 'non', '',
   'Hôtel de ville', 'Place de la Liberté', 'Sfax', '', '', '',
   'Defibtech Lifeline', 'SN-B-014', 'Accueil', '02/09/2023', 'installé', 'annuel', '02/09/2026',
   '', '31/08/2026', '', 'adulte', '', '31/08/2026'],
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
// idle → validating → preview → importing → done

export default function ClientImportPage() {
  const navigate  = useNavigate()
  const fileInput = useRef(null)

  const [step,       setStep]       = useState('idle')     // idle | validating | preview | importing | done
  const [file,       setFile]       = useState(null)
  const [dragOver,   setDragOver]   = useState(false)
  const [validation, setValidation] = useState(null)       // { results, summary }
  const [importRes,  setImportRes]  = useState(null)       // { results, summary }
  const [progress,   setProgress]   = useState(0)

  /* ── File selection ─────────────────────────────────── */

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

  /* ── Step 1 → 2: Validate ───────────────────────────── */

  async function handleValidate() {
    if (!file) return
    setStep('validating')
    try {
      const res = await validateImport(file)
      setValidation(res)
      setStep('preview')
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la validation.')
      setStep('idle')
    }
  }

  /* ── Step 3 → 4: Import ─────────────────────────────── */

  async function handleImport() {
    const validRows = validation.results.filter(r => r.valid).map(r => r.row)
    if (validRows.length === 0) return

    setStep('importing')
    setProgress(0)

    // Animate progress smoothly while the real request runs
    const TICK  = 120
    const timer = setInterval(() => {
      setProgress(p => (p < 88 ? p + Math.random() * 6 : p))
    }, TICK)

    try {
      const res = await executeImport(validRows)
      clearInterval(timer)
      setProgress(100)
      setImportRes(res)
      setTimeout(() => setStep('done'), 300)
    } catch (err) {
      clearInterval(timer)
      toast.error(err.message || 'Erreur lors de l\'import.')
      setStep('preview')
    }
  }

  /* ── Reset ───────────────────────────────────────────── */

  function reset() {
    setStep('idle')
    setFile(null)
    setValidation(null)
    setImportRes(null)
    setProgress(0)
    if (fileInput.current) fileInput.current.value = ''
  }

  /* ── Render ──────────────────────────────────────────── */

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
              Créez ou mettez à jour clients, sites et DAE depuis un fichier Excel
            </p>
          </div>
        </div>
      </div>

      {/* Step tracker */}
      <div className="ci-steps">
        {['Fichier', 'Validation', 'Import', 'Résultat'].map((label, i) => {
          const stepIdx = { idle: 0, validating: 1, preview: 1, importing: 2, done: 3 }[step]
          const done    = i < stepIdx
          const active  = i === stepIdx
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

        {/* ── IDLE ───────────────────────────────────── */}
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
                sont ignorées, et l'ordre n'a pas d'importance.
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
                Site sans nom → « Site principal ». Dates au format jj/mm/aaaa.
                Statut : « installé » ou « à installer ». Contrôle : « semestriel » ou « annuel ».
                Électrodes : « adulte » ou « enfant ».
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
                  onClick={handleValidate}
                >
                  {step === 'validating'
                    ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Validation…</>
                    : <><ChevronRight size={14} /> Valider le fichier</>
                  }
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── PREVIEW ────────────────────────────────── */}
        {step === 'preview' && validation && (
          <div className="ci-card">
            {/* Summary chips */}
            <div className="ci-preview-summary">
              <div className="ci-summary-chip ci-summary-chip--total">
                <FileSpreadsheet size={14} />
                <strong>{validation.summary.total}</strong> lignes lues
              </div>
              <div className="ci-summary-chip ci-summary-chip--ok">
                <CheckCircle2 size={14} />
                <strong>{validation.summary.valid}</strong> valide{validation.summary.valid !== 1 ? 's' : ''}
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <Users size={14} />
                <strong>{validation.summary.clients}</strong> client{validation.summary.clients !== 1 ? 's' : ''}
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <Building2 size={14} />
                <strong>{validation.summary.sites}</strong> site{validation.summary.sites !== 1 ? 's' : ''}
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <HeartPulse size={14} />
                <strong>{validation.summary.deas}</strong> DAE
              </div>
              {validation.summary.invalid > 0 && (
                <div className="ci-summary-chip ci-summary-chip--error">
                  <XCircle size={14} />
                  <strong>{validation.summary.invalid}</strong> erreur{validation.summary.invalid !== 1 ? 's' : ''}
                </div>
              )}
            </div>

            {/* Rows table */}
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
                    <th>Contrôle</th>
                    <th>Consommables</th>
                    <th style={{ width: 60 }}>Statut</th>
                    <th>Erreurs</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.results.map((r, i) => (
                    <tr key={i} className={r.valid ? '' : 'ci-row--error'}>
                      <td className="ci-row-num">{r.rowNum}</td>
                      <td className="ci-cell-name">
                        {r.row.name || <em className="ci-cell--empty">—</em>}
                        {(r.row.clientCity || r.row.siteCity) && (
                          <div className="ci-cell-sub">{r.row.siteCity || r.row.clientCity}</div>
                        )}
                      </td>
                      <td>
                        {r.siteName}
                        {r.row.siteContactName && <div className="ci-cell-sub">{r.row.siteContactName}</div>}
                      </td>
                      <td>
                        {r.hasDea ? (
                          <>
                            {r.row.deaType || <em className="ci-cell--empty">type ?</em>}
                            {r.row.deaSerial && <div className="ci-cell-sub">{r.row.deaSerial}</div>}
                          </>
                        ) : <em className="ci-cell--empty">—</em>}
                      </td>
                      <td>{r.row.deaLocation || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.deaInstallDate || <em className="ci-cell--empty">—</em>}</td>
                      <td>
                        {[r.row.deaControlType, r.row.deaNextControl].filter(Boolean).join(' · ')
                          || <em className="ci-cell--empty">—</em>}
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

            {validation.summary.invalid > 0 && (
              <div className="ci-warning-banner">
                <AlertTriangle size={14} />
                Les lignes en erreur seront ignorées lors de l'import. Seules les {validation.summary.valid} lignes valides seront importées.
              </div>
            )}

            {validation.summary.warnings > 0 && (
              <div className="ci-warning-banner">
                <AlertTriangle size={14} />
                {validation.summary.warnings} ligne{validation.summary.warnings !== 1 ? 's' : ''} porte
                {validation.summary.warnings !== 1 ? 'nt' : ''} un numéro de série déjà présent dans le parc.
                Ces lignes seront importées : vérifiez qu'il s'agit bien du même appareil.
              </div>
            )}

            <div className="ci-action-row">
              <button className="btn btn--ghost" onClick={reset}>
                <RotateCcw size={13} /> Changer de fichier
              </button>
              <button
                className="btn btn--primary"
                disabled={validation.summary.valid === 0}
                onClick={handleImport}
              >
                <Upload size={14} />
                Importer {validation.summary.clients} client{validation.summary.clients !== 1 ? 's' : ''}
                {' · '}{validation.summary.sites} site{validation.summary.sites !== 1 ? 's' : ''}
                {validation.summary.deas > 0 && ` · ${validation.summary.deas} DAE`}
              </button>
            </div>
          </div>
        )}

        {/* ── IMPORTING ──────────────────────────────── */}
        {step === 'importing' && (
          <div className="ci-card ci-card--center">
            <FileSpreadsheet size={48} className="ci-importing-icon" />
            <p className="ci-importing-title">Import en cours…</p>
            <p className="ci-importing-sub">
              Importation de {validation.summary.clients} client{validation.summary.clients !== 1 ? 's' : ''},
              {' '}{validation.summary.sites} site{validation.summary.sites !== 1 ? 's' : ''}
              {validation.summary.deas > 0 && ` et ${validation.summary.deas} DAE`}
            </p>
            <div className="ci-progress-wrap">
              <div className="ci-progress-bar">
                <div className="ci-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="ci-progress-pct">{Math.round(progress)}%</span>
            </div>
          </div>
        )}

        {/* ── DONE ───────────────────────────────────── */}
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
                  {importRes.summary.failed === 0
                    ? 'Import réussi !'
                    : 'Import terminé avec des erreurs'
                  }
                </p>
                <p className="ci-done-sub">
                  {importRes.summary.imported} client{importRes.summary.imported !== 1 ? 's' : ''} traité{importRes.summary.imported !== 1 ? 's' : ''}
                  {importRes.summary.created != null && ` (${importRes.summary.created} créé${importRes.summary.created !== 1 ? 's' : ''}, ${importRes.summary.updated || 0} mis à jour)`}
                  {importRes.summary.failed > 0 && `, ${importRes.summary.failed} échec${importRes.summary.failed !== 1 ? 's' : ''}`}
                  <br />
                  {importRes.summary.sitesCreated || 0} site{(importRes.summary.sitesCreated || 0) !== 1 ? 's' : ''} créé{(importRes.summary.sitesCreated || 0) !== 1 ? 's' : ''}
                  {' · '}{importRes.summary.deasCreated || 0} DAE ajouté{(importRes.summary.deasCreated || 0) !== 1 ? 's' : ''}
                  {' · '}{importRes.summary.deasUpdated || 0} DAE mis à jour
                </p>
              </div>
            </div>

            {/* Result rows */}
            <div className="ci-table-wrap">
              <table className="ci-preview-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Statut</th>
                    <th>Sites</th>
                    <th>DAE</th>
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
                      <td>{r.error && <span className="ci-error-inline">{r.error}</span>}</td>
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
