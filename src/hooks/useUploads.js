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

  /* Upload d'un fichier unique — renvoie une promesse résolue à la fin */
  const uploadFile = useCallback((file, parentId, displayName) => {
    return new Promise(resolve => {
      const id = uid()
      setUploads(prev => [
        ...prev,
        { id, name: displayName || file.name, type: 'file', size: file.size, progress: 0, status: 'uploading' },
      ])
      uploadWithProgress(file, parentId, {
        onProgress: pct => patch(id, { progress: pct }),
        onSuccess: () => { patch(id, { progress: 100, status: 'done' }); resolve(true) },
        onError: msg => { patch(id, { status: 'error', error: msg }); resolve(false) },
      })
    })
  }, [patch])

  /* Upload récursif d'une entrée du système de fichiers */
  const uploadEntry = useCallback(async (entry, parentId, pathPrefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej))
      await uploadFile(file, parentId, pathPrefix ? `${pathPrefix}/${file.name}` : file.name)
    } else if (entry.isDirectory) {
      const id = uid()
      const folderPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name
      setUploads(prev => [
        ...prev,
        { id, name: folderPath, type: 'folder', progress: 0, status: 'uploading' },
      ])
      let folder
      try {
        folder = await createFolder({ name: entry.name, parent: parentId })
      } catch (err) {
        patch(id, { status: 'error', error: err.message || 'Création du dossier échouée' })
        return
      }
      const children = await readAllEntries(entry.createReader())
      for (const child of children) {
        await uploadEntry(child, folder._id, folderPath)
      }
      patch(id, { progress: 100, status: 'done' })
    }
  }, [uploadFile, patch])

  /* Sélection classique (input file) → upload dans le dossier courant */
  const startFiles = useCallback((fileList, parentId) => {
    Array.from(fileList).forEach(file => {
      uploadFile(file, parentId).then(() => onChangeRef.current?.())
    })
  }, [uploadFile])

  /* Dépôt OS : gère fichiers ET dossiers (via l'API FileSystem Entry) */
  const startDrop = useCallback(async (dataTransfer, parentId) => {
    // Les entrées doivent être lues de façon synchrone (le DataTransfer expire après le handler)
    const entries = Array.from(dataTransfer.items || [])
      .map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean)

    if (entries.length && entries.some(e => e.isDirectory)) {
      for (const entry of entries) {
        await uploadEntry(entry, parentId, '')
      }
      onChangeRef.current?.()
    } else if (dataTransfer.files?.length) {
      startFiles(dataTransfer.files, parentId)
    }
  }, [uploadEntry, startFiles])

  const clear = useCallback(() => setUploads([]), [])

  const activeCount = uploads.filter(u => u.status === 'uploading').length

  return { uploads, activeCount, startFiles, startDrop, clear }
}
