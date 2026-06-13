const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

// Base URL for static files (strip /api suffix)
export const STATIC_BASE = BASE.replace(/\/api\/?$/, '')

async function request(path, options = {}) {
  const token = localStorage.getItem('token')
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

// Multipart upload (no Content-Type header — browser sets it with boundary)
export async function upload(path, formData) {
  const token = localStorage.getItem('token')
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
