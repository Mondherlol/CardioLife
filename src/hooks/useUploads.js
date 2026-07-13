import { useState, useCallback, useRef } from 'react'
import { createFolder, uploadWithProgress } from '../api/documents'

/* Identifiant unique pour chaque ligne d'upload */
function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/* Lit toutes les entrées d'un dossier (readEntries renvoie par lots) */
function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = []
    const step = () => reader.readEntries(batch => {
      if (!batch.length) resolve(all)
      else { all.push(...batch); step() }
    }, reject)
    step()
  })
}

/* Récupère le File d'une entrée fichier */
function entryFile(entry) {
  return new Promise((res, rej) => entry.file(res, rej))
}

/**
 * Gère l'état d'avancement des uploads (fichiers + dossiers récursifs).
 * @param {Function} onChange  appelé après chaque complétion pour rafraîchir la vue.
 */
export function useUploads(onChange) {
  const [uploads, setUploads] = useState([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const patch = useCallback((id, changes) => {
    setUploads(prev => prev.map(u => (u.id === id ? { ...u, ...changes } : u)))
  }, [])

  /* Upload d'un fichier déjà inscrit dans la liste (ligne `id` existante). */
  const runUpload = useCallback((id, file, parentId) => {
    return new Promise(resolve => {
      patch(id, { status: 'uploading', progress: 0 })
      uploadWithProgress(file, parentId, {
        onProgress: pct => patch(id, { progress: pct }),
        onSuccess: () => { patch(id, { progress: 100, status: 'done' }); resolve(true) },
        onError: msg => { patch(id, { status: 'error', error: msg }); resolve(false) },
      })
    })
  }, [patch])

  /* Sélection classique (input file) → tout est connu d'avance, upload en parallèle */
  const startFiles = useCallback((fileList, parentId) => {
    const rows = Array.from(fileList).map(file => ({
      id: uid(), name: file.name, type: 'file', size: file.size, progress: 0, status: 'uploading', _file: file,
    }))
    if (!rows.length) return
    setUploads(prev => [...prev, ...rows])
    rows.forEach(row => {
      uploadWithProgress(row._file, parentId, {
        onProgress: pct => patch(row.id, { progress: pct }),
        onSuccess: () => { patch(row.id, { progress: 100, status: 'done' }); onChangeRef.current?.() },
        onError: msg => { patch(row.id, { status: 'error', error: msg }) },
      })
    })
  }, [patch])

  /* Dépôt OS : gère fichiers ET dossiers (via l'API FileSystem Entry) */
  const startDrop = useCallback(async (dataTransfer, parentId) => {
    // Les entrées doivent être lues de façon synchrone (le DataTransfer expire après le handler)
    const entries = Array.from(dataTransfer.items || [])
      .map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean)

    const hasDir = entries.some(e => e.isDirectory)
    if (!hasDir) {
      if (dataTransfer.files?.length) startFiles(dataTransfer.files, parentId)
      return
    }

    // ── Phase 1 : énumération complète de l'arborescence ──────────────
    // On parcourt tout AVANT d'uploader : le total de fichiers est ainsi
    // connu dès le départ et la progression globale monte régulièrement.
    const folders = []   // { name, path, parentPath }  (parents avant enfants)
    const files   = []   // { entry, name, folderPath }

    async function walk(entry, prefix) {
      if (entry.isFile) {
        files.push({ entry, name: entry.name, folderPath: prefix })
      } else if (entry.isDirectory) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        folders.push({ name: entry.name, path, parentPath: prefix })
        const children = await readAllEntries(entry.createReader())
        for (const child of children) await walk(child, path)
      }
    }
    for (const entry of entries) await walk(entry, '')

    if (!files.length && !folders.length) return

    // Toutes les lignes de fichiers sont ajoutées d'un coup (statut « en attente »).
    const rows = files.map(f => ({
      id: uid(),
      name: f.folderPath ? `${f.folderPath}/${f.name}` : f.name,
      type: 'file', progress: 0, status: 'pending',
    }))
    setUploads(prev => [...prev, ...rows])

    // ── Phase 2 : création des dossiers (parents avant enfants) ───────
    const pathToId = { '': parentId }
    const failedPaths = new Set()
    for (const folder of folders) {
      const parent = pathToId[folder.parentPath]
      if (parent == null && folder.parentPath !== '') { failedPaths.add(folder.path); continue }
      try {
        const created = await createFolder({ name: folder.name, parent })
        pathToId[folder.path] = created._id
      } catch {
        failedPaths.add(folder.path)
      }
    }

    // ── Phase 3 : upload séquentiel des fichiers vers leur dossier ────
    for (let i = 0; i < files.length; i++) {
      const f   = files[i]
      const row = rows[i]
      const targetId = pathToId[f.folderPath]
      if (targetId == null) {
        patch(row.id, { status: 'error', error: 'Dossier parent introuvable' })
        continue
      }
      try {
        const file = await entryFile(f.entry)
        await runUpload(row.id, file, targetId)
      } catch {
        patch(row.id, { status: 'error', error: 'Lecture du fichier échouée' })
      }
    }

    onChangeRef.current?.()
  }, [startFiles, runUpload, patch])

  const clear = useCallback(() => setUploads([]), [])

  const activeCount = uploads.filter(u => u.status === 'uploading' || u.status === 'pending').length

  return { uploads, activeCount, startFiles, startDrop, clear }
}
