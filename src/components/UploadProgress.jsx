import { useState } from 'react'
import { X, ChevronDown, File, Folder, Check, AlertCircle, Loader2 } from 'lucide-react'

/**
 * Panneau flottant d'avancement des uploads (fichiers + dossiers).
 * Non bloquant, façon gestionnaire de fichiers — se réduit et se ferme.
 */
export default function UploadProgress({ uploads, onClear }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!uploads.length) return null

  const total   = uploads.length
  const done    = uploads.filter(u => u.status === 'done').length
  const errors  = uploads.filter(u => u.status === 'error').length
  const active  = uploads.filter(u => u.status === 'uploading').length
  const allDone = active === 0

  // Avancement global (les dossiers/terminés comptent pour 100 %)
  const overall = Math.round(
    uploads.reduce((sum, u) => sum + (u.status === 'uploading' ? u.progress : 100), 0) / total,
  )

  const title = allDone
    ? errors > 0
      ? `${done} terminé${done > 1 ? 's' : ''}${errors ? `, ${errors} échec${errors > 1 ? 's' : ''}` : ''}`
      : `${total} élément${total > 1 ? 's' : ''} envoyé${total > 1 ? 's' : ''}`
    : `Envoi en cours… ${overall}%`

  return (
    <div className="upl-panel">
      <div className="upl-header">
        <div className="upl-header-main">
          {allDone
            ? errors > 0
              ? <AlertCircle size={15} className="upl-header-icon upl-header-icon--error" />
              : <Check size={15} className="upl-header-icon upl-header-icon--done" />
            : <Loader2 size={15} className="upl-header-icon upl-header-icon--spin" />}
          <span className="upl-header-title">{title}</span>
        </div>
        <div className="upl-header-actions">
          <button
            className="upl-header-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Déplier' : 'Réduire'}
          >
            <ChevronDown size={16} className={`upl-chevron${collapsed ? ' upl-chevron--up' : ''}`} />
          </button>
          {allDone && (
            <button className="upl-header-btn" onClick={onClear} title="Fermer">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {!allDone && (
        <div className="upl-overall">
          <div className="upl-overall-fill" style={{ width: `${overall}%` }} />
        </div>
      )}

      {!collapsed && (
        <div className="upl-list">
          {uploads.map(u => (
            <div key={u.id} className="upl-item">
              <div className="upl-item-icon">
                {u.type === 'folder'
                  ? <Folder size={16} className="doc-icon doc-icon--folder" />
                  : <File size={16} className="doc-icon doc-icon--file" />}
              </div>
              <div className="upl-item-body">
                <div className="upl-item-top">
                  <span className="upl-item-name" title={u.name}>{u.name}</span>
                  <span className={`upl-item-status upl-item-status--${u.status}`}>
                    {u.status === 'uploading'
                      ? (u.type === 'folder' ? '…' : `${u.progress}%`)
                      : u.status === 'done'
                        ? <Check size={13} />
                        : <span title={u.error}>Échec</span>}
                  </span>
                </div>
                <div className="upl-bar">
                  <div
                    className={`upl-bar-fill upl-bar-fill--${u.status}${u.status === 'uploading' && u.type === 'folder' ? ' upl-bar-fill--indeterminate' : ''}`}
                    style={u.type === 'folder' && u.status === 'uploading' ? undefined : { width: `${u.status === 'error' ? 100 : u.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
