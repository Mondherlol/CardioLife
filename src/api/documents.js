import { get, post, put, del } from './http'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

export const getContents   = (parent, search) =>
  get(`/documents?${parent ? `parent=${parent}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`)

export const getFolderTree = ()                    => get('/documents/tree')
export const getDocStats   = ()                    => get('/documents/stats')
export const createFolder  = (data)               => post('/documents/folder', data)
export const renameDoc     = (id, name)            => put(`/documents/${id}/rename`, { name })
export const moveDoc       = (id, targetParent)    => put(`/documents/${id}/move`, { targetParent })
export const copyDoc       = (id, targetParent)    => post(`/documents/${id}/copy`, { targetParent })
export const updatePerms   = (id, perms)           => put(`/documents/${id}/permissions`, perms)
export const deleteDoc     = (id)                  => del(`/documents/${id}`)

export async function downloadDoc(id, filename) {
  const token = localStorage.getItem('token')
  const res   = await fetch(`${API_BASE}/documents/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message || 'Téléchargement échoué.')
  }
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function uploadWithProgress(file, parentId, { onProgress, onSuccess, onError } = {}) {
  const form = new FormData()
  form.append('file', file)
  if (parentId) form.append('parent', parentId)

  const xhr   = new XMLHttpRequest()
  const token = localStorage.getItem('token')

  xhr.open('POST', `${API_BASE}/documents/upload`)
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
  }
  xhr.onload = () => {
    if (xhr.status < 300) {
      try { onSuccess?.(JSON.parse(xhr.responseText)) } catch { onSuccess?.({}) }
    } else {
      try { onError?.(JSON.parse(xhr.responseText).message || 'Erreur upload') } catch { onError?.('Erreur upload') }
    }
  }
  xhr.onerror = () => onError?.('Erreur réseau')
  xhr.send(form)
  return xhr
}
