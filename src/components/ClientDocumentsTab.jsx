import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'react-toastify'
import {
  Folder, FolderOpen, File, FileText, Image, Film, Music, Archive, Code,
  FolderPlus, Upload, Download, Trash2, Pencil, Home, ChevronRight, X,
} from 'lucide-react'
import { ImageThumbnail, PdfThumbnail } from './FileThumbnail'
import DocumentPreviewModal from './DocumentPreviewModal'
import UploadProgress from './UploadProgress'
import { getClientDocumentsFolder } from '../api/clients'
import { getSiteDocumentsFolder } from '../api/sites'
import {
  getContents, createFolder, renameDoc, moveDoc, deleteDoc, downloadDoc,
} from '../api/documents'
import { useUploads } from '../hooks/useUploads'

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function FileIcon({ mimeType, size = 34 }) {
  if (!mimeType) return <File size={size} className="doc-icon doc-icon--file" />
  if (mimeType.startsWith('image/')) return <Image size={size} className="doc-icon doc-icon--image" />
  if (mimeType.startsWith('video/')) return <Film size={size} className="doc-icon doc-icon--video" />
  if (mimeType.startsWith('audio/')) return <Music size={size} className="doc-icon doc-icon--audio" />
  if (mimeType === 'application/pdf') return <FileText size={size} className="doc-icon doc-icon--pdf" />
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar'))
    return <Archive size={size} className="doc-icon doc-icon--archive" />
  if (mimeType.includes('text') || mimeType.includes('javascript') || mimeType.includes('json'))
    return <Code size={size} className="doc-icon doc-icon--code" />
  return <File size={size} className="doc-icon doc-icon--file" />
}

function isPreviewable(item) {
  return item.type === 'file' && (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf')
}

/* ── Rename modal (léger, local à cet onglet) ─────────────────── */
function RenameModal({ item, onClose, onSave }) {
  const [name, setName]     = useState(item.name)
  const [saving, setSaving] = useState(false)
  const inputRef            = useRef(null)

  useEffect(() => { inputRef.current?.select() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim()) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Renommer</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <input ref={inputRef} className="form-input form-input--plain" value={name}
              onChange={e => setName(e.target.value)} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : 'Renommer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── New folder modal ─────────────────────────────────────────── */
function NewFolderModal({ onClose, onSave }) {
  const [name, setName]     = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef             = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim()) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Nouveau dossier</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <input ref={inputRef} className="form-input form-input--plain" placeholder="Nom du dossier"
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Explorateur de documents rattaché à un dossier système.
 *
 * Passer `clientId` pour le dossier « Clients/<client> », ou `siteId` pour
 * « Clients/<client>/Sites/<site> » — le reste du fonctionnement est identique.
 */
export default function ClientDocumentsTab({ clientId, siteId, title = 'Documents du client' }) {
  const [rootFolderId, setRootFolderId] = useState(null)
  const [breadcrumb,   setBreadcrumb]   = useState([])   // [{id, name}] sous la racine du client
  const [items,        setItems]        = useState([])
  const [loading,      setLoading]      = useState(true)

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renaming,      setRenaming]      = useState(null)
  const [deleteTarget,  setDeleteTarget]  = useState(null)
  const [previewItem,   setPreviewItem]   = useState(null)

  const [dragging, setDragging] = useState(null)   // item interne en cours de drag
  const [dropOver, setDropOver] = useState(null)   // id du dossier/crumb survolé

  const fileInputRef = useRef(null)
  const currentFolder = breadcrumb.length ? breadcrumb[breadcrumb.length - 1].id : rootFolderId

  useEffect(() => {
    const request = siteId
      ? getSiteDocumentsFolder(siteId)
      : getClientDocumentsFolder(clientId)
    request
      .then(data => setRootFolderId(data.folderId))
      .catch(() => toast.error(`Impossible de charger le dossier du ${siteId ? 'site' : 'client'}.`))
  }, [clientId, siteId])

  const fetchItems = useCallback(async () => {
    if (!currentFolder) return
    setLoading(true)
    try {
      const data = await getContents(currentFolder)
      setItems(data)
    } catch (err) {
      toast.error(err.message || 'Impossible de charger les documents.')
    } finally {
      setLoading(false)
    }
  }, [currentFolder])

  useEffect(() => { fetchItems() }, [fetchItems])

  const { uploads, activeCount, startFiles, startDrop, clear: clearUploads } = useUploads(fetchItems)

  function openFolder(item) {
    setBreadcrumb(prev => [...prev, { id: item._id, name: item.name }])
  }

  function goToCrumb(index) {
    // index === -1 => racine du client
    setBreadcrumb(prev => index < 0 ? [] : prev.slice(0, index + 1))
  }

  async function handleCreateFolder(name) {
    await createFolder({ name, parent: currentFolder })
    toast.success('Dossier créé.')
    setNewFolderOpen(false)
    fetchItems()
  }

  async function handleRename(name) {
    await renameDoc(renaming._id, name)
    toast.success('Renommé.')
    setRenaming(null)
    fetchItems()
  }

  async function handleDelete() {
    await deleteDoc(deleteTarget._id)
    toast.success('Supprimé.')
    setDeleteTarget(null)
    fetchItems()
  }

  function handleFilesSelected(files) {
    startFiles(files, currentFolder)
  }

  function openItem(item) {
    if (item.type === 'folder') { openFolder(item); return }
    if (isPreviewable(item)) setPreviewItem(item)
    else downloadDoc(item._id, item.name).catch(err => toast.error(err.message))
  }

  /* ── Drag & drop ─────────────────────────────────────────── */

  function handleDragStart(e, item) {
    setDragging(item)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDragging(null)
    setDropOver(null)
  }

  function handleDragOver(e, targetId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropOver(targetId)
  }

  async function handleDrop(e, targetFolderId) {
    e.preventDefault()
    e.stopPropagation()
    setDropOver(null)
    if (!dragging) {
      // Dépôt OS (fichiers/dossiers) directement sur un dossier cible
      if (e.dataTransfer.items?.length || e.dataTransfer.files?.length) {
        startDrop(e.dataTransfer, targetFolderId)
      }
      return
    }
    if (dragging._id === targetFolderId) return

    try {
      await moveDoc(dragging._id, targetFolderId)
      toast.success(`${dragging.name} déplacé.`)
      setDragging(null)
      fetchItems()
    } catch (err) {
      toast.error(err.message)
    }
  }

  function handleMainDragOver(e) {
    e.preventDefault()
    // Surligne pour un drag interne OU un dépôt de fichiers/dossiers depuis l'OS
    if (dragging || e.dataTransfer.types?.includes('Files')) setDropOver('__main__')
  }

  function handleMainDrop(e) {
    e.preventDefault()
    if (!dragging) {
      // Fichiers ou dossiers déposés depuis l'OS → upload dans le dossier courant
      startDrop(e.dataTransfer, currentFolder)
    } else if (dragging.parent !== currentFolder) {
      handleDrop(e, currentFolder)
    }
    setDropOver(null)
  }

  const previewableSiblings = items.filter(isPreviewable)

  return (
    <div className="cd-docs-tab">
      <div className="cd-tab-header">
        <h3 className="cd-tab-title">{title}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus size={13} /> Nouveau dossier
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={13} /> {activeCount > 0 ? `Envoi… (${activeCount})` : 'Uploader'}
          </button>
        </div>
      </div>

      <div className="docs-breadcrumb" style={{ marginBottom: 12 }}>
        <button
          className="docs-bc-item"
          onClick={() => goToCrumb(-1)}
          onDragOver={e => handleDragOver(e, rootFolderId)}
          onDragLeave={() => setDropOver(null)}
          onDrop={e => handleDrop(e, rootFolderId)}
          style={dropOver === rootFolderId && dragging ? { outline: '2px dashed var(--brand)' } : undefined}
        >
          <Home size={13} />
        </button>
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.id} className="docs-bc-item-wrap">
            <ChevronRight size={12} className="docs-bc-sep" />
            <button
              className="docs-bc-item"
              onClick={() => goToCrumb(i)}
              onDragOver={e => handleDragOver(e, crumb.id)}
              onDragLeave={() => setDropOver(null)}
              onDrop={e => handleDrop(e, crumb.id)}
              style={dropOver === crumb.id && dragging ? { outline: '2px dashed var(--brand)' } : undefined}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      <div
        className={`docs-drop-zone${dropOver === '__main__' ? ' docs-drop-zone--over' : ''}`}
        onDragOver={handleMainDragOver}
        onDragLeave={() => setDropOver(null)}
        onDrop={handleMainDrop}
      >
      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="cd-tab-empty">
          <Folder size={40} color="var(--gray-300)" />
          <p>Ce dossier est vide. Glissez des fichiers ou des dossiers ici pour les uploader.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus size={13} /> Nouveau dossier
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => fileInputRef.current?.click()}>
              <Upload size={13} /> Uploader un fichier
            </button>
          </div>
        </div>
      ) : (
        <div className="docs-grid">
          {items.map(item => (
            <div
              key={item._id}
              className={[
                'docs-card',
                item.type === 'folder' ? 'docs-card--folder' : 'docs-card--file',
                dropOver === item._id && item.type === 'folder' && dragging ? 'docs-card--drop-over' : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={e => handleDragStart(e, item)}
              onDragEnd={handleDragEnd}
              onDragOver={item.type === 'folder' ? e => { e.stopPropagation(); handleDragOver(e, item._id) } : undefined}
              onDragLeave={item.type === 'folder' ? () => setDropOver(null) : undefined}
              onDrop={item.type === 'folder' ? e => handleDrop(e, item._id) : undefined}
              onClick={() => openItem(item)}
            >
              <div className="docs-card-visual">
                {item.type === 'folder' ? (
                  <Folder size={40} className="doc-icon doc-icon--folder" />
                ) : item.mimeType?.startsWith('image/') ? (
                  <ImageThumbnail id={item._id} />
                ) : item.mimeType === 'application/pdf' ? (
                  <PdfThumbnail id={item._id} />
                ) : (
                  <FileIcon mimeType={item.mimeType} size={34} />
                )}
              </div>
              <div className="docs-card-name" title={item.name}>{item.name}</div>
              <div className="docs-card-meta">
                {item.type === 'file' ? formatSize(item.size) : 'Dossier'}
                {' · '}
                {formatDate(item.updatedAt)}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {item.type === 'file' && (
                  <button
                    type="button"
                    className="action-btn action-btn--edit"
                    title="Télécharger"
                    onClick={e => { e.stopPropagation(); downloadDoc(item._id, item.name).catch(err => toast.error(err.message)) }}
                  >
                    <Download size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="action-btn action-btn--edit"
                  title="Renommer"
                  onClick={e => { e.stopPropagation(); setRenaming(item) }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="action-btn action-btn--delete"
                  title="Supprimer"
                  onClick={e => { e.stopPropagation(); setDeleteTarget(item) }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleFilesSelected(e.target.files); e.target.value = '' }}
      />

      {newFolderOpen && (
        <NewFolderModal onClose={() => setNewFolderOpen(false)} onSave={handleCreateFolder} />
      )}
      {renaming && (
        <RenameModal item={renaming} onClose={() => setRenaming(null)} onSave={handleRename} />
      )}
      {deleteTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal modal--sm">
            <div className="modal-header">
              <h2 className="modal-title">Supprimer</h2>
              <button className="modal-close" onClick={() => setDeleteTarget(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p>
                Supprimer <strong>{deleteTarget.name}</strong> ?
                {deleteTarget.type === 'folder' && ' Son contenu sera également supprimé.'}
              </p>
              <div className="modal-footer">
                <button className="btn btn--ghost" onClick={() => setDeleteTarget(null)}>Annuler</button>
                <button className="btn btn--danger" onClick={handleDelete}>Supprimer</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {previewItem && (
        <DocumentPreviewModal
          item={previewItem}
          siblings={previewableSiblings}
          onClose={() => setPreviewItem(null)}
        />
      )}

      <UploadProgress uploads={uploads} onClear={clearUploads} />
    </div>
  )
}
