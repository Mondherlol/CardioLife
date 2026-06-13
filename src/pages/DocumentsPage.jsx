import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'react-toastify'
import DocumentPreviewModal from '../components/DocumentPreviewModal'
import { ImageThumbnail, PdfThumbnail } from '../components/FileThumbnail'
import {
  Folder, FolderOpen, File, FileText, Image, Film, Music, Archive, Code,
  Plus, Upload, Download, Trash2, Pencil, Copy, Scissors, ClipboardPaste,
  ChevronRight, Home, Search, X, AlertTriangle, Shield, Users,
  HardDrive, RotateCcw, MoreVertical, Check, Lock, FolderPlus,
} from 'lucide-react'
import {
  getContents, getFolderTree, getDocStats, createFolder,
  renameDoc, moveDoc, copyDoc, updatePerms, deleteDoc,
  downloadDoc, uploadWithProgress,
} from '../api/documents'
import { getUsers } from '../api/users'
import { useAuth } from '../context/AuthContext'
import { useLoadingBar } from '../hooks/useLoadingBar'

/* ── Constants ───────────────────────────────────────────────── */

const ROLES = ['superadmin', 'admin', 'technicien', 'commercial', 'assistante', 'readonly']
const ROLE_LABELS = {
  superadmin: 'Super Admin', admin: 'Admin', technicien: 'Technicien',
  commercial: 'Commercial', assistante: 'Assistante', readonly: 'Lecture seule',
}

/* ── Helpers ─────────────────────────────────────────────────── */

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`
}

function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

/* ── File type icon ──────────────────────────────────────────── */

function FileIcon({ mimeType, size = 28 }) {
  if (!mimeType) return <File size={size} className="doc-icon doc-icon--file" />
  if (mimeType.startsWith('image/'))  return <Image   size={size} className="doc-icon doc-icon--image" />
  if (mimeType.startsWith('video/'))  return <Film    size={size} className="doc-icon doc-icon--video" />
  if (mimeType.startsWith('audio/'))  return <Music   size={size} className="doc-icon doc-icon--audio" />
  if (mimeType === 'application/pdf') return <FileText size={size} className="doc-icon doc-icon--pdf" />
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z'))
    return <Archive size={size} className="doc-icon doc-icon--archive" />
  if (mimeType.includes('text') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml'))
    return <Code size={size} className="doc-icon doc-icon--code" />
  if (mimeType.includes('word') || mimeType.includes('excel') || mimeType.includes('sheet') || mimeType.includes('presentation'))
    return <FileText size={size} className="doc-icon doc-icon--office" />
  return <File size={size} className="doc-icon doc-icon--file" />
}

/* ── Folder tree (recursive) ─────────────────────────────────── */

function TreeNode({ folder, allFolders, currentFolder, onNavigate, depth = 0 }) {
  const children = allFolders.filter(f => f.parent?.toString() === folder._id.toString())
  const [open, setOpen] = useState(false)
  const isActive = currentFolder === folder._id

  return (
    <div>
      <button
        className={`docs-tree-item${isActive ? ' docs-tree-item--active' : ''}`}
        style={{ paddingLeft: depth * 14 + 10 }}
        onClick={() => { onNavigate(folder._id); if (children.length) setOpen(v => !v) }}
      >
        {children.length > 0
          ? open ? <FolderOpen size={13} className="docs-tree-icon" /> : <Folder size={13} className="docs-tree-icon" />
          : <Folder size={13} className="docs-tree-icon" />
        }
        {children.length > 0 && (
          <ChevronRight
            size={10}
            className={`docs-tree-chevron${open ? ' docs-tree-chevron--open' : ''}`}
            onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          />
        )}
        <span className="docs-tree-label">{folder.name}</span>
      </button>
      {open && children.map(child => (
        <TreeNode key={child._id} folder={child} allFolders={allFolders}
          currentFolder={currentFolder} onNavigate={onNavigate} depth={depth + 1} />
      ))}
    </div>
  )
}

/* ── Permissions modal ───────────────────────────────────────── */

function PermissionsModal({ item, allUsers, onClose, onSave }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    inherit:  item.permissions?.inherit  ?? true,
    isPublic: item.permissions?.isPublic ?? false,
    roles:    item.permissions?.roles    || [],
    users:    (item.permissions?.users   || []).map(u => u._id || u.toString()),
  })

  function toggleRole(role) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role],
    }))
  }
  function toggleUser(uid) {
    setForm(f => ({
      ...f,
      users: f.users.includes(uid) ? f.users.filter(id => id !== uid) : [...f.users, uid],
    }))
  }

  async function handleSave() {
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><Shield size={16} /> Permissions — {item.name}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="perm-inherit-group">
            <label className={`perm-inherit-opt${form.inherit ? ' perm-inherit-opt--active' : ''}`}
              onClick={() => setForm(f => ({ ...f, inherit: true }))}>
              <div className="perm-inherit-radio">{form.inherit && <Check size={10} />}</div>
              <div>
                <div className="perm-inherit-title">Hériter des permissions</div>
                <div className="perm-inherit-desc">Utilise les permissions du dossier parent (ou accès public si dossier racine)</div>
              </div>
            </label>
            <label className={`perm-inherit-opt${!form.inherit ? ' perm-inherit-opt--active' : ''}`}
              onClick={() => setForm(f => ({ ...f, inherit: false }))}>
              <div className="perm-inherit-radio">{!form.inherit && <Check size={10} />}</div>
              <div>
                <div className="perm-inherit-title">Permissions personnalisées</div>
                <div className="perm-inherit-desc">Définir qui a accès à ce dossier et son contenu</div>
              </div>
            </label>
          </div>

          {!form.inherit && (
            <>
              <div className="form-section-title" style={{ marginTop: 16 }}>Accès général</div>
              <label className="perm-item">
                <span>Accès public (tous les utilisateurs connectés)</span>
                <span className="perm-toggle">
                  <input type="checkbox" checked={form.isPublic}
                    onChange={e => setForm(f => ({ ...f, isPublic: e.target.checked }))} />
                  <span className="perm-toggle-track" />
                </span>
              </label>

              {!form.isPublic && (
                <>
                  <div className="form-section-title" style={{ marginTop: 14 }}>Rôles autorisés</div>
                  <div className="perm-grid">
                    {ROLES.map(role => (
                      <label key={role} className="perm-item">
                        <span>{ROLE_LABELS[role]}</span>
                        <span className="perm-toggle">
                          <input type="checkbox" checked={form.roles.includes(role)}
                            onChange={() => toggleRole(role)} />
                          <span className="perm-toggle-track" />
                        </span>
                      </label>
                    ))}
                  </div>

                  {allUsers.length > 0 && (
                    <>
                      <div className="form-section-title" style={{ marginTop: 14 }}>Utilisateurs spécifiques</div>
                      <div className="perm-users-list">
                        {allUsers.map(u => (
                          <label key={u._id} className="perm-user-row">
                            <input type="checkbox" checked={form.users.includes(u._id)}
                              onChange={() => toggleUser(u._id)} />
                            <div className="user-avatar user-avatar--sm">{initials(u.fullName)}</div>
                            <span className="perm-user-name">{u.fullName}</span>
                            <span className={`user-role-badge user-role-badge--${u.role}`}>{ROLE_LABELS[u.role] ?? u.role}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner spinner--sm" /> : null}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Rename modal ────────────────────────────────────────────── */

function RenameModal({ item, onClose, onSave }) {
  const [name, setName]       = useState(item.name)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const inputRef              = useRef(null)

  useEffect(() => { inputRef.current?.select() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    try { await onSave(name.trim()) } catch (err) { setError(err.message); setSaving(false) }
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
              onChange={e => { setName(e.target.value); setError('') }} />
            {error && <span className="form-error">{error}</span>}
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

/* ── New folder modal ────────────────────────────────────────── */

function NewFolderModal({ onClose, onSave }) {
  const [name, setName]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const inputRef            = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    try { await onSave(name.trim()) } catch (err) { setError(err.message); setSaving(false) }
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
              value={name} onChange={e => { setName(e.target.value); setError('') }} />
            {error && <span className="form-error">{error}</span>}
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

/* ── Delete confirm ──────────────────────────────────────────── */

function DeleteConfirmModal({ item, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    try { await onConfirm() } catch { setDeleting(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Supprimer</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="destroy-warning">
            <AlertTriangle size={18} />
            <p>
              Supprimer <strong>{item.name}</strong> ?
              {item.type === 'folder' && ' Son contenu sera également supprimé.'}
              <br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cette action est irréversible.</span>
            </p>
          </div>
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={handleConfirm} disabled={deleting}>
              {deleting ? <span className="spinner spinner--sm" /> : 'Supprimer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Upload progress panel ───────────────────────────────────── */

function UploadPanel({ uploads, onCancel, onClear }) {
  const done = uploads.filter(u => u.status !== 'uploading').length
  const total = uploads.length

  return (
    <div className="docs-upload-panel">
      <div className="docs-upload-panel-header">
        <span>{done < total ? `Envoi en cours… (${done}/${total})` : `${total} fichier${total > 1 ? 's' : ''} envoyé${total > 1 ? 's' : ''}`}</span>
        {done === total && (
          <button className="docs-upload-panel-close" onClick={onClear}><X size={14} /></button>
        )}
      </div>
      <div className="docs-upload-list">
        {uploads.map(u => (
          <div key={u.id} className="docs-upload-item">
            <div className="docs-upload-item-info">
              <span className="docs-upload-item-name">{u.name}</span>
              <span className={`docs-upload-item-status docs-upload-item-status--${u.status}`}>
                {u.status === 'uploading' ? `${u.progress}%` : u.status === 'done' ? '✓' : u.error || 'Erreur'}
              </span>
            </div>
            <div className="docs-upload-bar">
              <div
                className={`docs-upload-bar-fill docs-upload-bar-fill--${u.status}`}
                style={{ width: `${u.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Context menu ────────────────────────────────────────────── */

function ContextMenu({ menu, onAction, onClose, isAdmin }) {
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) { if (!ref.current?.contains(e.target)) onClose() }
    function handleKey(e)   { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey) }
  }, [onClose])

  // Constrain to viewport
  const style = { position: 'fixed', top: menu.y, left: menu.x, zIndex: 9999 }

  const { item, hasClipboard, canPreview } = menu

  return (
    <div ref={ref} className="docs-ctx-menu" style={style}>
      {item ? (
        <>
          {item.type === 'folder' && (
            <button className="docs-ctx-item" onClick={() => onAction('open')}>
              <FolderOpen size={14} /> Ouvrir
            </button>
          )}
          {item.type === 'file' && canPreview && (
            <button className="docs-ctx-item docs-ctx-item--preview" onClick={() => onAction('preview')}>
              <Image size={14} /> Aperçu
            </button>
          )}
          {item.type === 'file' && (
            <button className="docs-ctx-item" onClick={() => onAction('download')}>
              <Download size={14} /> Télécharger
            </button>
          )}
          <div className="docs-ctx-sep" />
          <button className="docs-ctx-item" onClick={() => onAction('cut')}>
            <Scissors size={14} /> Couper
          </button>
          <button className="docs-ctx-item" onClick={() => onAction('copy')}>
            <Copy size={14} /> Copier
          </button>
          {hasClipboard && (
            <button className="docs-ctx-item" onClick={() => onAction('paste')}>
              <ClipboardPaste size={14} /> Coller ici
            </button>
          )}
          <div className="docs-ctx-sep" />
          <button className="docs-ctx-item" onClick={() => onAction('rename')}>
            <Pencil size={14} /> Renommer
          </button>
          {item.type === 'folder' && isAdmin && (
            <button className="docs-ctx-item" onClick={() => onAction('permissions')}>
              <Shield size={14} /> Permissions
            </button>
          )}
          <div className="docs-ctx-sep" />
          <button className="docs-ctx-item docs-ctx-item--danger" onClick={() => onAction('delete')}>
            <Trash2 size={14} /> Supprimer
          </button>
        </>
      ) : (
        <>
          <button className="docs-ctx-item" onClick={() => onAction('newFolder')}>
            <FolderPlus size={14} /> Nouveau dossier
          </button>
          {hasClipboard && (
            <button className="docs-ctx-item" onClick={() => onAction('paste')}>
              <ClipboardPaste size={14} /> Coller
            </button>
          )}
        </>
      )}
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */

export default function DocumentsPage() {
  const { user: currentUser } = useAuth()
  const isAdmin = ['admin', 'superadmin'].includes(currentUser?.role)

  const [currentFolder, setCurrentFolder] = useState(null)
  const [items,         setItems]         = useState([])
  const [tree,          setTree]          = useState([])
  const [stats,         setStats]         = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [allUsers,      setAllUsers]      = useState([])

  const [clipboard,     setClipboard]     = useState(null)   // { mode:'cut'|'copy', item }
  const [dragging,      setDragging]      = useState(null)   // item being dragged
  const [dropOver,      setDropOver]      = useState(null)   // folder id being dragged over

  const [ctxMenu,       setCtxMenu]       = useState(null)   // { x, y, item, hasClipboard }
  const [uploads,       setUploads]       = useState([])     // progress items

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renaming,      setRenaming]      = useState(null)
  const [permItem,      setPermItem]      = useState(null)
  const [deleteTarget,  setDeleteTarget]  = useState(null)
  const [previewItem,   setPreviewItem]   = useState(null)

  const fileInputRef = useRef(null)

  useLoadingBar(loading)

  /* ── Data fetching ─────────────────────────────────────────── */

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getContents(currentFolder, search)
      setItems(data)
    } catch (err) {
      toast.error(err.message || 'Impossible de charger les documents.')
    } finally {
      setLoading(false)
    }
  }, [currentFolder, search])

  const refreshAll = useCallback(async () => {
    const [, treeData, statsData] = await Promise.all([
      fetchItems(),
      getFolderTree().catch(() => []),
      getDocStats().catch(() => null),
    ])
    setTree(treeData)
    setStats(statsData)
  }, [fetchItems])

  useEffect(() => { refreshAll() }, [refreshAll])

  useEffect(() => {
    if (isAdmin) getUsers().then(setAllUsers).catch(() => {})
  }, [isAdmin])

  /* ── Breadcrumb ────────────────────────────────────────────── */

  function buildBreadcrumb(folderId) {
    if (!folderId) return []
    const crumbs = []
    let id = folderId
    while (id) {
      const f = tree.find(x => x._id === id)
      if (!f) break
      crumbs.unshift(f)
      id = f.parent
    }
    return crumbs
  }

  const breadcrumb = buildBreadcrumb(currentFolder)

  /* ── Folder creation ───────────────────────────────────────── */

  async function handleCreateFolder(name) {
    await createFolder({ name, parent: currentFolder })
    toast.success('Dossier créé.')
    setNewFolderOpen(false)
    refreshAll()
  }

  /* ── Rename ────────────────────────────────────────────────── */

  async function handleRename(name) {
    await renameDoc(renaming._id, name)
    toast.success('Renommé.')
    setRenaming(null)
    refreshAll()
  }

  /* ── Delete ────────────────────────────────────────────────── */

  async function handleDelete() {
    await deleteDoc(deleteTarget._id)
    toast.success('Supprimé.')
    setDeleteTarget(null)
    refreshAll()
  }

  /* ── Drag & Drop ───────────────────────────────────────────── */

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

  function handleDragLeave() {
    setDropOver(null)
  }

  async function handleDrop(e, targetFolderId) {
    e.preventDefault()
    setDropOver(null)
    if (!dragging) return
    if (dragging._id === targetFolderId) return
    if (dragging.type === 'folder' && dragging._id === targetFolderId) return

    try {
      await moveDoc(dragging._id, targetFolderId)
      toast.success(`${dragging.name} déplacé.`)
      setDragging(null)
      refreshAll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  /* ── Clipboard ─────────────────────────────────────────────── */

  function handleCut(item) {
    setClipboard({ mode: 'cut', item })
    toast.info(`${item.name} coupé.`, { autoClose: 2000 })
  }

  function handleCopy(item) {
    setClipboard({ mode: 'copy', item })
    toast.info(`${item.name} copié.`, { autoClose: 2000 })
  }

  async function handlePaste(targetFolder) {
    if (!clipboard) return
    const dest = targetFolder ?? currentFolder
    try {
      if (clipboard.mode === 'cut') {
        await moveDoc(clipboard.item._id, dest)
        toast.success(`${clipboard.item.name} déplacé.`)
        setClipboard(null)
      } else {
        await copyDoc(clipboard.item._id, dest)
        toast.success(`${clipboard.item.name} copié.`)
      }
      refreshAll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  /* ── Permissions ───────────────────────────────────────────── */

  async function handleSavePerms(form) {
    await updatePerms(permItem._id, form)
    toast.success('Permissions mises à jour.')
    setPermItem(null)
  }

  /* ── Upload ────────────────────────────────────────────────── */

  function handleFilesSelected(files) {
    Array.from(files).forEach(file => {
      const id = crypto.randomUUID()
      setUploads(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }])

      uploadWithProgress(file, currentFolder, {
        onProgress: (pct) => setUploads(prev =>
          prev.map(u => u.id === id ? { ...u, progress: pct } : u)),
        onSuccess: () => {
          setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: 100, status: 'done' } : u))
          refreshAll()
        },
        onError: (msg) => {
          setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: msg } : u))
          toast.error(`${file.name} : ${msg}`)
        },
      })
    })
  }

  /* ── Context menu ──────────────────────────────────────────── */

  function openCtxMenu(e, item = null) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth  - 200)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setCtxMenu({ x, y, item, hasClipboard: !!clipboard, canPreview: item ? isPreviewable(item) : false })
  }

  async function handleCtxAction(action) {
    const item = ctxMenu?.item
    setCtxMenu(null)
    switch (action) {
      case 'open':        setCurrentFolder(item._id); break
      case 'preview':     openPreview(item); break
      case 'download':    downloadDoc(item._id, item.name).catch(err => toast.error(err.message)); break
      case 'cut':         handleCut(item); break
      case 'copy':        handleCopy(item); break
      case 'paste':       handlePaste(item?.type === 'folder' ? item._id : null); break
      case 'rename':      setRenaming(item); break
      case 'permissions': setPermItem(item); break
      case 'delete':      setDeleteTarget(item); break
      case 'newFolder':   setNewFolderOpen(true); break
    }
  }

  /* ── Preview ───────────────────────────────────────────────── */

  function isPreviewable(item) {
    return item.type === 'file' && (
      item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf'
    )
  }

  const previewableSiblings = items.filter(isPreviewable)

  function openPreview(item) {
    if (isPreviewable(item)) setPreviewItem(item)
    else handleDownload(item)
  }

  /* ── Download ──────────────────────────────────────────────── */

  function handleDownload(item) {
    downloadDoc(item._id, item.name).catch(err => toast.error(err.message))
  }

  /* ── Drag-over on main area ──────────────────────────────────*/

  function handleMainDragOver(e) {
    e.preventDefault()
    if (dragging) setDropOver('__main__')
  }

  function handleMainDrop(e) {
    e.preventDefault()
    if (!dragging) {
      // File drop from OS
      const files = e.dataTransfer.files
      if (files.length) handleFilesSelected(files)
    } else {
      // Moving item to current folder
      handleDrop(e, currentFolder)
    }
    setDropOver(null)
  }

  /* ── Storage bar ──────────────────────────────────────────── */

  const usedPct = stats
    ? Math.min(100, Math.round((stats.usedBytes / (stats.maxTotalSpaceMB * 1024 * 1024)) * 100))
    : 0

  /* ── Render ─────────────────────────────────────────────────── */

  const rootFolders = tree.filter(f => !f.parent)

  return (
    <div className="page-content docs-page">
      <div className="docs-layout">

        {/* ── Left sidebar ── */}
        <aside className="docs-sidebar">
          <div className="docs-sidebar-header">
            <span>Mes documents</span>
          </div>

          <div className="docs-tree">
            <button
              className={`docs-tree-item docs-tree-item--root${!currentFolder ? ' docs-tree-item--active' : ''}`}
              onClick={() => setCurrentFolder(null)}
              onDragOver={e => handleDragOver(e, null)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, null)}
            >
              <Home size={13} className="docs-tree-icon" />
              <span className="docs-tree-label">Racine</span>
            </button>
            {rootFolders.map(folder => (
              <TreeNode key={folder._id} folder={folder} allFolders={tree}
                currentFolder={currentFolder} onNavigate={setCurrentFolder} depth={0} />
            ))}
          </div>

          {stats && (
            <div className="docs-storage">
              <div className="docs-storage-label">
                <HardDrive size={12} />
                <span>{formatSize(stats.usedBytes)} / {stats.maxTotalSpaceMB} Mo</span>
              </div>
              <div className="docs-storage-track">
                <div className="docs-storage-fill" style={{ width: `${usedPct}%`,
                  background: usedPct > 90 ? 'var(--red-500)' : usedPct > 70 ? 'var(--amber-500)' : 'var(--brand)' }} />
              </div>
              <div className="docs-storage-pct">{usedPct}% utilisé</div>
            </div>
          )}
        </aside>

        {/* ── Main area ── */}
        <div className="docs-main">

          {/* Toolbar */}
          <div className="docs-toolbar">
            <div className="docs-breadcrumb">
              <button className="docs-bc-item" onClick={() => setCurrentFolder(null)}>
                <Home size={13} />
              </button>
              {breadcrumb.map((f, i) => (
                <span key={f._id} className="docs-bc-item-wrap">
                  <ChevronRight size={12} className="docs-bc-sep" />
                  <button className="docs-bc-item" onClick={() => setCurrentFolder(f._id)}>{f.name}</button>
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {clipboard && (
                <button className="btn btn--ghost btn--sm" onClick={() => handlePaste(null)}
                  title={`Coller : ${clipboard.item.name}`}>
                  <ClipboardPaste size={14} />
                  <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {clipboard.mode === 'cut' ? 'Déplacer' : 'Coller'} {clipboard.item.name}
                  </span>
                  <button style={{ marginLeft: 4, opacity: 0.5 }} onClick={e => { e.stopPropagation(); setClipboard(null) }}>
                    <X size={12} />
                  </button>
                </button>
              )}
              <button className="btn btn--ghost btn--sm" onClick={() => setNewFolderOpen(true)}>
                <FolderPlus size={14} /> Nouveau dossier
              </button>
              <button className="btn btn--primary btn--sm" onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} /> Uploader
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="docs-search-bar">
            <Search size={13} className="search-icon" />
            <input className="search-input" placeholder="Rechercher des fichiers…"
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="search-clear" onClick={() => setSearch('')}><X size={12} /></button>}
          </div>

          {/* Drop zone + grid */}
          <div
            className={`docs-drop-zone${dropOver === '__main__' ? ' docs-drop-zone--over' : ''}`}
            onDragOver={handleMainDragOver}
            onDragLeave={() => setDropOver(null)}
            onDrop={handleMainDrop}
            onContextMenu={e => openCtxMenu(e, null)}
          >
            {loading ? (
              <div className="table-loading"><span className="spinner" /></div>
            ) : items.length === 0 ? (
              <div className="docs-empty">
                <Folder size={48} color="var(--gray-300)" />
                <p>{search ? 'Aucun résultat.' : 'Ce dossier est vide.'}</p>
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
                {items.map(item => {
                  const isCut      = clipboard?.mode === 'cut' && clipboard?.item?._id === item._id
                  const isDragOver = dropOver === item._id && item.type === 'folder'

                  return (
                    <div
                      key={item._id}
                      className={[
                        'docs-card',
                        item.type === 'folder' ? 'docs-card--folder' : 'docs-card--file',
                        isCut     ? 'docs-card--cut' : '',
                        isDragOver ? 'docs-card--drop-over' : '',
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={e => handleDragStart(e, item)}
                      onDragEnd={handleDragEnd}
                      onDragOver={item.type === 'folder' ? e => handleDragOver(e, item._id) : undefined}
                      onDragLeave={item.type === 'folder' ? handleDragLeave : undefined}
                      onDrop={item.type === 'folder' ? e => handleDrop(e, item._id) : undefined}
                      onClick={() => item.type === 'folder' ? setCurrentFolder(item._id) : openPreview(item)}
                      onContextMenu={e => openCtxMenu(e, item)}
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
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleFilesSelected(e.target.files); e.target.value = '' }}
      />

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          onAction={handleCtxAction}
          onClose={() => setCtxMenu(null)}
          isAdmin={isAdmin}
        />
      )}

      {/* Upload panel */}
      {uploads.length > 0 && (
        <UploadPanel
          uploads={uploads}
          onClear={() => setUploads([])}
        />
      )}

      {/* Modals */}
      {newFolderOpen && (
        <NewFolderModal onClose={() => setNewFolderOpen(false)} onSave={handleCreateFolder} />
      )}
      {renaming && (
        <RenameModal item={renaming} onClose={() => setRenaming(null)} onSave={handleRename} />
      )}
      {permItem && (
        <PermissionsModal
          item={permItem}
          allUsers={allUsers}
          onClose={() => setPermItem(null)}
          onSave={handleSavePerms}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          item={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
      {previewItem && (
        <DocumentPreviewModal
          item={previewItem}
          siblings={previewableSiblings}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  )
}
