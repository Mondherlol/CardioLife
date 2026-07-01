import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  ArrowLeft, Upload, Download, FileSpreadsheet, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, RotateCcw, Check,
  Users, Info,
} from 'lucide-react'
import { validateImport, executeImport } from '../api/clients'
import { toast } from 'react-toastify'

/* ── Sample data ─────────────────────────────────────────── */

const SAMPLE_COLUMNS = [
  { key: 'nom',              label: 'Nom',                required: true,  example: 'Clinique El Amel' },
  { key: 'type',             label: 'Type',               required: true,  example: 'Clinique' },
  { key: 'rue',              label: 'Rue',                required: false, example: '12 Av. Habib Bourguiba' },
  { key: 'ville',            label: 'Ville',              required: false, example: 'Tunis' },
  { key: 'gouvernorat',      label: 'Gouvernorat',        required: false, example: 'Tunis' },
  { key: 'contact nom',      label: 'Contact Nom',        required: false, example: 'Ahmed Ben Ali' },
  { key: 'téléphone 1',      label: 'Téléphone 1',        required: false, example: '+216 71 000 000' },
  { key: 'téléphone 2',      label: 'Téléphone 2',        required: false, example: '+216 20 000 000' },
  { key: 'email 1',          label: 'Email 1',            required: false, example: 'contact@elamel.tn' },
  { key: 'email 2',          label: 'Email 2',            required: false, example: 'daf@elamel.tn' },
  { key: 'latitude',         label: 'Latitude GPS',       required: false, example: '36.8065' },
  { key: 'longitude',        label: 'Longitude GPS',      required: false, example: '10.1815' },
  { key: 'responsable',      label: 'Responsable interne',required: false, example: 'Sophie Martin' },
  { key: 'notes',            label: 'Notes',              required: false, example: 'Contrat prioritaire' },
]

const SAMPLE_ROWS = [
  ['Clinique El Amel', 'Clinique', '12 Av. Habib Bourguiba', 'Tunis', 'Tunis', 'Ahmed Ben Ali', '+216 71 100 200', '', 'contact@elamel.tn', '', '36.8065', '10.1815', 'Sophie Martin', 'Contrat prioritaire'],
  ['Mairie de Sfax', 'Mairie', 'Place de la Liberté', 'Sfax', 'Sfax', 'Fatma Trabelsi', '+216 74 200 300', '+216 74 200 301', 'mairie@sfax.tn', '', '34.7406', '10.7603', 'Pierre Dupont', ''],
  ['École Secondaire Ibn Khaldoun', 'École', 'Rue de l\'Indépendance', 'Sousse', 'Sousse', '', '+216 73 300 400', '', '', '', '35.8245', '10.6346', '', 'Renouvellement prévu juin'],
]

function downloadSample() {
  const ws = XLSX.utils.aoa_to_sheet([
    SAMPLE_COLUMNS.map(c => c.key),
    ...SAMPLE_ROWS,
  ])

  ws['!cols'] = SAMPLE_COLUMNS.map(() => ({ wch: 22 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Clients')
  XLSX.writeFile(wb, 'modele_import_clients.xlsx')
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
            <h1 className="page-title">Importer des clients</h1>
            <p className="page-subtitle">
              Importez ou mettez à jour plusieurs clients depuis un fichier Excel
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
              <div className="ci-table-wrap">
                <table className="ci-sample-table">
                  <thead>
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
              <p className="ci-legend"><span className="ci-required">*</span> Champs obligatoires</p>
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
                <Users size={14} />
                <strong>{validation.summary.total}</strong> lignes lues
              </div>
              <div className="ci-summary-chip ci-summary-chip--ok">
                <CheckCircle2 size={14} />
                <strong>{validation.summary.valid}</strong> valide{validation.summary.valid !== 1 ? 's' : ''}
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
                    <th>Nom</th>
                    <th>Type</th>
                    <th>Ville</th>
                    <th>Gouvernorat</th>
                    <th>Contact</th>
                    <th>Téléphone</th>
                    <th>Email</th>
                    <th>GPS</th>
                    <th>Responsable</th>
                    <th style={{ width: 60 }}>Statut</th>
                    <th>Erreurs</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.results.map((r, i) => (
                    <tr key={i} className={r.valid ? '' : 'ci-row--error'}>
                      <td className="ci-row-num">{r.rowNum}</td>
                      <td className="ci-cell-name">{r.row.name || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.type || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.city || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.governorate || <em className="ci-cell--empty">-</em>}</td>
                      <td>{r.row.contactName || <em className="ci-cell--empty">-</em>}</td>
                      <td>{r.row.phone1 || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.email1 || <em className="ci-cell--empty">—</em>}</td>
                      <td>
                        {r.row.gpsLat || r.row.gpsLng
                          ? `${r.row.gpsLat || '?'} / ${r.row.gpsLng || '?'}`
                          : <em className="ci-cell--empty">-</em>
                        }
                      </td>
                      <td>{r.row.internalManager || <em className="ci-cell--empty">-</em>}</td>
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
                Importer {validation.summary.valid} client{validation.summary.valid !== 1 ? 's' : ''}
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
              Importation de {validation.summary.valid} client{validation.summary.valid !== 1 ? 's' : ''}
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
                  {importRes.summary.imported} client{importRes.summary.imported !== 1 ? 's' : ''} importé{importRes.summary.imported !== 1 ? 's' : ''}
                  {importRes.summary.created != null && ` (${importRes.summary.created} cree${importRes.summary.created !== 1 ? 's' : ''}, ${importRes.summary.updated || 0} mis a jour)`}
                  {importRes.summary.failed > 0 && `, ${importRes.summary.failed} échec${importRes.summary.failed !== 1 ? 's' : ''}`}
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
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {importRes.results.map((r, i) => (
                    <tr key={i} className={r.success ? '' : 'ci-row--error'}>
                      <td className="ci-cell-name">{r.name}</td>
                      <td>
                        {r.success
                          ? <span className="ci-status ci-status--ok"><CheckCircle2 size={14} /> {r.action === 'updated' ? 'Mis a jour' : 'Cree'}</span>
                          : <span className="ci-status ci-status--error"><XCircle size={14} /> Échec</span>
                        }
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
