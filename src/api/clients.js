import { get, post, put, del } from './http'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

async function authFetch(url, opts = {}) {
  const token = localStorage.getItem('token')
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Erreur ${res.status}`)
  return data
}

export const getClients       = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/clients${qs ? `?${qs}` : ''}`)
}
export const getClient        = (id)       => get(`/clients/${id}`)
export const createClient     = (data)     => post('/clients', data)
export const updateClient     = (id, data) => put(`/clients/${id}`, data)
export const archiveClient    = (id)       => del(`/clients/${id}`)
export const restoreClient    = (id)       => put(`/clients/${id}/restore`)
export const destroyClient    = (id)       => del(`/clients/${id}/permanent`)
export const updateClientDocs = (id, ids)  => put(`/clients/${id}/documents`, { ids })

export function validateImport(file) {
  const form  = new FormData()
  form.append('file', file)
  return authFetch(`${API_BASE}/clients/import/validate`, { method: 'POST', body: form })
}

export function executeImport(rows) {
  return authFetch(`${API_BASE}/clients/import/execute`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ rows }),
  })
}
