import { get, post, put, del } from './http'

export const getContracts = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/contracts${qs ? `?${qs}` : ''}`)
}
export const getContract        = (id)       => get(`/contracts/${id}`)
export const getContractStats   = ()         => get('/contracts/stats')
export const getNextNumber      = ()         => get('/contracts/next-number')
export const createContract     = (data)     => post('/contracts', data)
export const updateContract     = (id, data) => put(`/contracts/${id}`, data)
export const archiveContract    = (id)       => del(`/contracts/${id}`)
export const restoreContract    = (id)       => put(`/contracts/${id}/restore`)
export const destroyContract    = (id)       => del(`/contracts/${id}/permanent`)

export const CONTRACT_TYPES = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'location',    label: 'Location' },
  { value: 'vente',       label: 'Vente' },
  { value: 'autre',       label: 'Autre' },
]

export const CONTRACT_STATUSES = [
  { value: 'brouillon', label: 'Brouillon', cls: 'ct-status--draft'  },
  { value: 'actif',     label: 'Actif',     cls: 'ct-status--active' },
  { value: 'expire',    label: 'Expiré',    cls: 'ct-status--expired'},
  { value: 'resilie',   label: 'Résilié',   cls: 'ct-status--ended'  },
]
