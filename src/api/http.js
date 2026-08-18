const DEFAULT_BASE = import.meta.env.DEV
  ? 'http://localhost:5000/api'
  : `${window.location.origin}/api`

const BASE = import.meta.env.VITE_API_URL || DEFAULT_BASE

// Base URL for static files (strip /api suffix)
export const STATIC_BASE = BASE.replace(/\/api\/?$/, '')

async function request(path, options = {}) {
  const token = sessionStorage.getItem('token')
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err = new Error(data.message || 'Erreur serveur.')
    err.status = res.status
    err.errors = data.errors
    throw err
  }
  return data
}

export const get   = (path)        => request(path)
export const post  = (path, body)  => request(path, { method: 'POST',   body: JSON.stringify(body) })
export const put   = (path, body)  => request(path, { method: 'PUT',    body: JSON.stringify(body) })
export const patch = (path, body)  => request(path, { method: 'PATCH',  body: JSON.stringify(body) })
export const del   = (path)        => request(path, { method: 'DELETE' })

/**
 * Réponse binaire (archive, PDF…) déclenchée comme un téléchargement.
 *
 * Le serveur renvoie du JSON quand il refuse : on le lit pour rendre l'erreur
 * lisible, au lieu de laisser le navigateur enregistrer un fichier vide.
 */
export async function download(path, fallbackName) {
  const token = sessionStorage.getItem('token')
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.message || 'Erreur serveur.')
    err.status = res.status
    throw err
  }

  // Le serveur nomme le fichier ; sans en-tête exploitable, on retombe sur le
  // nom proposé par l'appelant.
  const disposition = res.headers.get('Content-Disposition') || ''
  const named = disposition.match(/filename="?([^";]+)"?/i)

  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = named?.[1] || fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return { name: a.download, size: blob.size, count: Number(res.headers.get('X-Image-Count')) || 0 }
}

// Multipart upload (no Content-Type header — browser sets it with boundary)
export async function upload(path, formData) {
  const token = sessionStorage.getItem('token')
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err = new Error(data.message || 'Erreur serveur.')
    err.status = res.status
    throw err
  }
  return data
}
