import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  ArrowLeft, Upload, Download, FileSpreadsheet, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, RotateCcw, Check,
  Info, Boxes, PlusCircle, RefreshCw,
} from 'lucide-react'
import { toast } from 'react-toastify'
import {
  validateProductImport, executeProductImport, exportProducts,
} from '../api/products'
import { getProductCategories } from '../api/productCategories'

/* ── Modèle de fichier ────────────────────────────────────────
   Une ligne = un modèle du catalogue. Les colonnes sont exactement celles de
   l'export : on exporte, on corrige dans Excel, on réimporte. Le rapprochement
   se fait sur la référence quand elle est là, sur le nom sinon — un modèle déjà
   au catalogue est mis à jour, jamais dupliqué. */

const COLUMNS = [
  { key: 'Nom',                    label: 'Nom',              required: true },
  { key: 'Catégorie',              label: 'Catégorie',        required: true },
  { key: 'Référence',              label: 'Référence' },
  { key: 'Marque',                 label: 'Marque' },
  { key: 'Mode',                   label: 'Mode' },
  { key: 'Numéro de série requis', label: 'N° série requis' },
  { key: 'Numéro de lot requis',   label: 'N° lot requis' },
  { key: 'Stock',                  label: 'Stock' },
  { key: "Seuil d'alerte",         label: "Seuil d'alerte" },
  { key: "Prix d'achat",           label: "Prix d'achat" },
  { key: 'Prix de vente',          label: 'Prix de vente' },
  { key: 'Fournisseur',            label: 'Fournisseur' },
  { key: 'Description',            label: 'Description' },
  { key: 'Notes',                  label: 'Notes' },
]

const SAMPLE_ROWS = [
  ['Zoll AED 3', 'Défibrillateurs', 'ZOLL-AED3', 'Zoll', 'semi-automatique',
   'oui', 'non', '4', '2', '1450', '1990', 'Zoll Medical', 'DAE semi-automatique écran couleur', ''],
  ['Defibtech Lifeline VIEW', 'Défibrillateurs', 'DFB-VIEW', 'Defibtech', 'automatique',
   'oui', 'non', '2', '1', '1300', '1850', 'Defibtech', '', ''],
  ['Électrodes adultes Zoll CPR-D', 'Électrodes', 'ZOLL-CPRD', 'Zoll', '',
   'non', 'oui', '20', '6', '95', '160', 'Zoll Medical', 'Valables 5 ans', ''],
  ['Batterie Zoll AED 3', 'Batteries', 'ZOLL-BAT3', 'Zoll', '',
   'oui', 'non', '8', '3', '210', '320', 'Zoll Medical', '', ''],
]

/** Écrit un classeur d'une feuille, colonnes calibrées. */
function writeSheet(rows, filename, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = (rows[0] || []).map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

function downloadSample() {
  writeSheet([COLUMNS.map(c => c.key), ...SAMPLE_ROWS], 'modele_import_produits.xlsx', 'Produits')
}

/* ── Steps ────────────────────────────────────────────────────
   idle → validating → preview → importing → done */

export default function ProductImportPage() {
  const navigate  = useNavigate()
  const fileInput = useRef(null)

  const [step,       setStep]       = useState('idle')
  const [file,       setFile]       = useState(null)
  const [dragOver,   setDragOver]   = useState(false)
  const [validation, setValidation] = useState(null)
  const [importRes,  setImportRes]  = useState(null)
  const [progress,   setProgress]   = useState(0)
  const [exporting,  setExporting]  = useState(false)
  // Catégories existantes : ce sont les seules valeurs acceptées en colonne 2.
  const [categories, setCategories] = useState([])

  useEffect(() => {
    getProductCategories()
      .then(d => setCategories(Array.isArray(d) ? d : (d?.data || [])))
      .catch(() => {})
  }, [])

  /* ── Export du catalogue ────────────────────────────── */

  async function handleExport() {
    setExporting(true)
    try {
      const { columns, rows, total } = await exportProducts()
      if (!total) { toast.info('Le catalogue est vide — rien à exporter.'); return }
      writeSheet(
        [columns.map(c => c.header), ...rows.map(r => columns.map(c => r[c.key] ?? ''))],
        `catalogue_produits_${new Date().toISOString().slice(0, 10)}.xlsx`,
        'Produits',
      )
      toast.success(`${total} produit${total !== 1 ? 's' : ''} exporté${total !== 1 ? 's' : ''}.`)
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'export.")
    } finally {
      setExporting(false)
    }
  }

  /* ── Choix du fichier ───────────────────────────────── */

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

  /* ── Validation ─────────────────────────────────────── */

  async function handleValidate() {
    if (!file) return
    setStep('validating')
    try {
      setValidation(await validateProductImport(file))
      setStep('preview')
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la validation.')
      setStep('idle')
    }
  }

  /* ── Import ─────────────────────────────────────────── */

  async function handleImport() {
    const validRows = validation.results.filter(r => r.valid).map(r => r.row)
    if (validRows.length === 0) return

    setStep('importing')
    setProgress(0)
    const timer = setInterval(() => {
      setProgress(p => (p < 88 ? p + Math.random() * 6 : p))
    }, 120)

    try {
      const res = await executeProductImport(validRows)
      clearInterval(timer)
      setProgress(100)
      setImportRes(res)
      setTimeout(() => setStep('done'), 300)
    } catch (err) {
      clearInterval(timer)
      toast.error(err.message || "Erreur lors de l'import.")
      setStep('preview')
    }
  }

  function reset() {
    setStep('idle')
    setFile(null)
    setValidation(null)
    setImportRes(null)
    setProgress(0)
    if (fileInput.current) fileInput.current.value = ''
  }

  /* ── Rendu ──────────────────────────────────────────── */

  return (
    <div className="page-content ci-root">

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={() => navigate('/stock')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">Import / export du catalogue</h1>
            <p className="page-subtitle">
              Types et modèles de défibrillateurs, électrodes, batteries — depuis un fichier Excel
            </p>
          </div>
        </div>
        <button className="btn btn--ghost" onClick={handleExport} disabled={exporting}>
          {exporting
            ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Export…</>
            : <><Download size={14} /> Exporter le catalogue</>}
        </button>
      </div>

      {/* Étapes */}
      <div className="ci-steps">
        {['Fichier', 'Validation', 'Import', 'Résultat'].map((label, i) => {
          const stepIdx = { idle: 0, validating: 1, preview: 1, importing: 2, done: 3 }[step]
          const done    = i < stepIdx
          const active  = i === stepIdx
          return (
            <div key={label} className={`ci-step${done ? ' ci-step--done' : active ? ' ci-step--active' : ''}`}>
              <div className="ci-step-bubble">{done ? <Check size={13} /> : i + 1}</div>
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
            <div className="ci-card">
              <div className="ci-card-header">
                <Info size={15} />
                <span>Format attendu</span>
                <button className="btn btn--ghost btn--sm ci-dl-btn" onClick={downloadSample}>
                  <Download size={13} /> Télécharger le modèle
                </button>
              </div>
              <p className="ci-format-intro">
                <strong>Une ligne = un modèle du catalogue.</strong> Le fichier exporté a
                exactement ces colonnes : exportez, corrigez dans Excel, réimportez.
                Un modèle déjà connu — même référence, ou à défaut même nom — est
                <strong> mis à jour</strong>, jamais dupliqué. Les colonnes absentes sont
                ignorées, l'ordre n'a pas d'importance, et une cellule vide n'efface rien.
              </p>

              <div className="ci-table-wrap">
                <table className="ci-sample-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(c => (
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
                <span className="ci-required">*</span> Nom et catégorie sont obligatoires.
                Mode : « automatique » ou « semi-automatique ». Oui / non pour les colonnes
                de suivi. Le stock n'est repris qu'à la création d'un nouveau modèle :
                pour un produit existant, la quantité se règle depuis le stock.
                {categories.length > 0 && (
                  <>
                    <br />
                    Catégories acceptées : <strong>{categories.map(c => c.name).join(', ')}</strong>.
                  </>
                )}
              </p>
            </div>

            {/* Dépôt du fichier */}
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
                    <button className="ci-file-remove"
                      onClick={e => { e.stopPropagation(); reset() }} title="Retirer">×</button>
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
                <button className="btn btn--primary" disabled={!file || step === 'validating'}
                  onClick={handleValidate}>
                  {step === 'validating'
                    ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Validation…</>
                    : <><ChevronRight size={14} /> Valider le fichier</>}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── APERÇU ─────────────────────────────────── */}
        {step === 'preview' && validation && (
          <div className="ci-card">
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
                <PlusCircle size={14} />
                <strong>{validation.summary.created}</strong> à créer
              </div>
              <div className="ci-summary-chip ci-summary-chip--total">
                <RefreshCw size={14} />
                <strong>{validation.summary.updated}</strong> à mettre à jour
              </div>
              {validation.summary.invalid > 0 && (
                <div className="ci-summary-chip ci-summary-chip--error">
                  <XCircle size={14} />
                  <strong>{validation.summary.invalid}</strong> erreur{validation.summary.invalid !== 1 ? 's' : ''}
                </div>
              )}
            </div>

            <div className="ci-table-wrap">
              <table className="ci-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>#</th>
                    <th>Produit</th>
                    <th>Catégorie</th>
                    <th>Référence</th>
                    <th>Marque</th>
                    <th>Suivi</th>
                    <th>Stock</th>
                    <th>Prix</th>
                    <th style={{ width: 90 }}>Action</th>
                    <th>Erreurs</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.results.map((r, i) => (
                    <tr key={i} className={r.valid ? '' : 'ci-row--error'}>
                      <td className="ci-row-num">{r.rowNum}</td>
                      <td className="ci-cell-name">
                        {r.row.name || <em className="ci-cell--empty">—</em>}
                        {r.row.deviceMode && <div className="ci-cell-sub">{r.row.deviceMode}</div>}
                      </td>
                      <td>{r.categoryName || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.reference || <em className="ci-cell--empty">—</em>}</td>
                      <td>{r.row.brand || <em className="ci-cell--empty">—</em>}</td>
                      <td>
                        {[r.row.requiresSerialNumber && 'n° série', r.row.requiresLotNumber && 'lot']
                          .filter(Boolean).join(' · ') || <em className="ci-cell--empty">—</em>}
                      </td>
                      <td>{r.row.stock || <em className="ci-cell--empty">—</em>}</td>
                      <td>
                        {[r.row.purchasePrice && `achat ${r.row.purchasePrice}`,
                          r.row.salePrice && `vente ${r.row.salePrice}`]
                          .filter(Boolean).join(' · ') || <em className="ci-cell--empty">—</em>}
                      </td>
                      <td>
                        {!r.valid
                          ? <span className="ci-status ci-status--error"><XCircle size={14} /></span>
                          : r.action === 'update'
                            ? <span className="ci-status"><RefreshCw size={13} /> Mise à jour</span>
                            : <span className="ci-status ci-status--ok"><PlusCircle size={13} /> Création</span>}
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
                Les lignes en erreur seront ignorées. Seules les {validation.summary.valid} lignes
                valides seront importées.
              </div>
            )}

            <div className="ci-action-row">
              <button className="btn btn--ghost" onClick={reset}>
                <RotateCcw size={13} /> Changer de fichier
              </button>
              <button className="btn btn--primary" disabled={validation.summary.valid === 0}
                onClick={handleImport}>
                <Upload size={14} />
                Importer {validation.summary.created} création{validation.summary.created !== 1 ? 's' : ''}
                {' · '}{validation.summary.updated} mise{validation.summary.updated !== 1 ? 's' : ''} à jour
              </button>
            </div>
          </div>
        )}

        {/* ── IMPORT EN COURS ────────────────────────── */}
        {step === 'importing' && (
          <div className="ci-card ci-card--center">
            <FileSpreadsheet size={48} className="ci-importing-icon" />
            <p className="ci-importing-title">Import en cours…</p>
            <p className="ci-importing-sub">
              {validation.summary.valid} produit{validation.summary.valid !== 1 ? 's' : ''} traité
              {validation.summary.valid !== 1 ? 's' : ''}
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
                {importRes.summary.failed === 0 ? <CheckCircle2 size={32} /> : <AlertTriangle size={32} />}
              </div>
              <div>
                <p className="ci-done-title">
                  {importRes.summary.failed === 0 ? 'Import réussi !' : 'Import terminé avec des erreurs'}
                </p>
                <p className="ci-done-sub">
                  {importRes.summary.created} produit{importRes.summary.created !== 1 ? 's' : ''} créé
                  {importRes.summary.created !== 1 ? 's' : ''}
                  {' · '}{importRes.summary.updated} mis à jour
                  {importRes.summary.failed > 0 && ` · ${importRes.summary.failed} échec${importRes.summary.failed !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>

            <div className="ci-table-wrap">
              <table className="ci-preview-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Catégorie</th>
                    <th>Statut</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {importRes.results.map((r, i) => (
                    <tr key={i} className={r.success ? '' : 'ci-row--error'}>
                      <td className="ci-cell-name">{r.name}</td>
                      <td>{r.category || <em className="ci-cell--empty">—</em>}</td>
                      <td>
                        {r.success
                          ? <span className="ci-status ci-status--ok">
                              <CheckCircle2 size={14} /> {r.action === 'updated' ? 'Mis à jour' : 'Créé'}
                            </span>
                          : <span className="ci-status ci-status--error"><XCircle size={14} /> Échec</span>}
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
              <button className="btn btn--primary" onClick={() => navigate('/stock')}>
                <Boxes size={14} /> Voir le catalogue
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
