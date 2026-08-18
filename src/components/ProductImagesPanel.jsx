import { useState, useRef } from 'react'
import {
  Upload, Download, FileArchive, CheckCircle2, XCircle, AlertTriangle,
  Info, RotateCcw, Images, FolderOpen,
} from 'lucide-react'
import { toast } from 'react-toastify'

/**
 * Transfert des visuels du catalogue, en archive ZIP.
 *
 * Une image ne tient pas dans une cellule : elle passe par une archive, où
 * chaque dossier porte le nom d'un produit. C'est ce nom qui fait le lien au
 * retour — la référence si elle existe, le nom du modèle sinon, la même règle
 * que le classeur.
 *
 * Rien n'oblige à repartir de l'export : un dossier créé à la main, nommé comme
 * le produit, est repris tel quel. C'est le cas courant — on a les photos, on
 * n'a pas encore les fiches.
 *
 * Props :
 *  onExport - () => Promise<{ name, size, count }>
 *  onImport - (file, { replace }) => Promise<{ results, summary }>
 */
export default function ProductImagesPanel({ onExport, onImport }) {
  const fileInput = useRef(null)

  const [file,      setFile]      = useState(null)
  const [dragOver,  setDragOver]  = useState(false)
  const [replace,   setReplace]   = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState(null)

  async function handleExport() {
    setExporting(true)
    try {
      const { count, size } = await onExport()
      toast.success(`${count} image${count !== 1 ? 's' : ''} exportée${count !== 1 ? 's' : ''}`
        + ` (${(size / 1048576).toFixed(1)} Mo).`)
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'export.")
    } finally {
      setExporting(false)
    }
  }

  function pick(files) {
    const f = files?.[0]
    if (!f) return
    if (!f.name.match(/\.zip$/i)) {
      toast.error('Seules les archives .zip sont acceptées.')
      return
    }
    setFile(f)
    setResult(null)
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    try {
      const res = await onImport(file, { replace })
      setResult(res)
      const { images, matched, unmatched } = res.summary
      if (images > 0) {
        toast.success(`${images} image${images !== 1 ? 's' : ''} reprise${images !== 1 ? 's' : ''}`
          + ` sur ${matched} produit${matched !== 1 ? 's' : ''}.`)
      }
      if (unmatched > 0) {
        toast.warn(`${unmatched} dossier${unmatched !== 1 ? 's' : ''} sans produit correspondant.`)
      }
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'import.")
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setFile(null)
    setResult(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="ci-body">

      {/* ── Export ── */}
      <div className="ci-card">
        <div className="ci-card-header">
          <Images size={15} />
          <span>Exporter les visuels</span>
          <button className="btn btn--ghost btn--sm ci-dl-btn" onClick={handleExport} disabled={exporting}>
            {exporting
              ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Export…</>
              : <><Download size={13} /> Télécharger l'archive</>}
          </button>
        </div>
        <p className="ci-format-intro">
          Une archive <strong>.zip</strong>, un dossier par produit. Le dossier porte
          la <strong>référence</strong> du produit, ou son <strong>nom</strong> si elle est vide —
          la même règle que le classeur Excel.
        </p>
        <pre className="ci-tree">{`catalogue-images/
  LISEZ-MOI.txt
  ZOLL AED 3 (Automatique)/
    01.jpg
    02.jpg
  Electrode adulte POWERHEART G3/
    01.jpg`}</pre>
      </div>

      {/* ── Import ── */}
      <div className="ci-card">
        <div className="ci-card-header">
          <Upload size={15} />
          <span>Reprendre des visuels</span>
        </div>
        <p className="ci-format-intro">
          Pas besoin de partir de l'export : créez un dossier par produit, nommé
          comme lui, déposez-y les photos, zippez le tout. Les images sont classées
          par ordre alphabétique de fichier — préfixez-les <code>01-</code>,
          {' '}<code>02-</code> pour choisir laquelle sert de vignette. Un dossier
          sans produit correspondant est signalé et ignoré.
        </p>

        <div
          className={`ci-dropzone${dragOver ? ' ci-dropzone--over' : ''}${file ? ' ci-dropzone--filled' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files) }}
          onClick={() => !file && fileInput.current?.click()}
        >
          <input ref={fileInput} type="file" accept=".zip" style={{ display: 'none' }}
            onChange={e => pick(e.target.files)} />
          {file ? (
            <div className="ci-file-selected">
              <FileArchive size={32} className="ci-file-icon" />
              <div className="ci-file-info">
                <span className="ci-file-name">{file.name}</span>
                <span className="ci-file-size">{(file.size / 1048576).toFixed(1)} Mo</span>
              </div>
              <button className="ci-file-remove"
                onClick={e => { e.stopPropagation(); reset() }} title="Retirer">×</button>
            </div>
          ) : (
            <>
              <FileArchive size={28} className="ci-drop-icon" />
              <p className="ci-drop-title">Glissez votre archive ici</p>
              <p className="ci-drop-sub">ou <span className="ci-drop-link">parcourir</span> — .zip</p>
            </>
          )}
        </div>

        {/* Ajouter est le geste sûr : on n'efface pas un visuel que personne
            n'a demandé à retirer. Remplacer reste possible, dit explicitement. */}
        <div className="choice-row" style={{ marginTop: 12 }}>
          <button type="button"
            className={`choice-btn${!replace ? ' choice-btn--on choice-btn--on-green' : ''}`}
            onClick={() => setReplace(false)}>
            <Upload size={14} /> Ajouter aux images existantes
          </button>
          <button type="button"
            className={`choice-btn${replace ? ' choice-btn--on' : ''}`}
            onClick={() => setReplace(true)}>
            <RotateCcw size={14} /> Remplacer les images
          </button>
        </div>
        <p className="ci-legend">
          <Info size={12} />{' '}
          {replace
            ? 'Les visuels actuels des produits présents dans l\'archive seront supprimés du serveur, puis remplacés par ceux de l\'archive.'
            : 'Les visuels actuels sont conservés ; ceux de l\'archive viennent s\'ajouter à la suite.'}
        </p>

        <div className="ci-action-row">
          <button className="btn btn--primary" disabled={!file || importing} onClick={handleImport}>
            {importing
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Import…</>
              : <><Upload size={14} /> Importer les images</>}
          </button>
        </div>
      </div>

      {/* ── Résultat ── */}
      {result && (
        <div className="ci-card">
          <div className="ci-preview-summary">
            <div className="ci-summary-chip ci-summary-chip--total">
              <FolderOpen size={14} />
              <strong>{result.summary.folders}</strong> dossier{result.summary.folders !== 1 ? 's' : ''} lu{result.summary.folders !== 1 ? 's' : ''}
            </div>
            <div className="ci-summary-chip ci-summary-chip--ok">
              <CheckCircle2 size={14} />
              <strong>{result.summary.images}</strong> image{result.summary.images !== 1 ? 's' : ''} reprise{result.summary.images !== 1 ? 's' : ''}
            </div>
            {result.summary.unmatched > 0 && (
              <div className="ci-summary-chip ci-summary-chip--error">
                <XCircle size={14} />
                <strong>{result.summary.unmatched}</strong> sans correspondance
              </div>
            )}
          </div>

          <div className="ci-table-wrap">
            <table className="ci-preview-table">
              <thead>
                <tr>
                  <th>Dossier</th>
                  <th>Produit</th>
                  <th>Images</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i} className={r.success ? '' : 'ci-row--error'}>
                    <td className="ci-cell-name">{r.folder}</td>
                    <td>{r.product || <em className="ci-cell--empty">—</em>}</td>
                    <td>
                      {r.success
                        ? `${r.count} ${r.mode}${r.total !== r.count ? ` · ${r.total} au total` : ''}`
                        : `${r.count} ignorée${r.count !== 1 ? 's' : ''}`}
                    </td>
                    <td>
                      {r.success
                        ? <span className="ci-status ci-status--ok"><CheckCircle2 size={14} /> Repris</span>
                        : <span className="ci-status ci-status--error">
                            <XCircle size={14} /> {r.error}
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.summary.unmatched > 0 && (
            <div className="ci-warning-banner">
              <AlertTriangle size={14} />
              Renommez ces dossiers avec la référence ou le nom exact du produit, puis
              réimportez l'archive — rien n'a été créé à l'aveugle.
            </div>
          )}

          <div className="ci-action-row">
            <button className="btn btn--ghost" onClick={reset}>
              <RotateCcw size={13} /> Nouvelle archive
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
