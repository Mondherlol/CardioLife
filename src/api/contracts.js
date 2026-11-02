import { get, post, put, del } from './http'

export const getContracts = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/contracts${qs ? `?${qs}` : ''}`)
}
export const getContract        = (id)       => get(`/contracts/${id}`)
export const getContractStats   = ()         => get('/contracts/stats')
// Contrats actifs regroupés par client, avec leur montant cumulé.
export const getClientTotals    = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/contracts/client-totals${qs ? `?${qs}` : ''}`)
}
export const getNextNumber      = ()         => get('/contracts/next-number')
export const createContract     = (data)     => post('/contracts', data)
export const updateContract     = (id, data) => put(`/contracts/${id}`, data)
// Le site sort du contrat, tout de suite ou à une date : { date?, reason? }.
export const terminateContract  = (id, body = {}) => post(`/contracts/${id}/terminate`, body)
export const cancelTermination  = (id)       => del(`/contracts/${id}/terminate`)
export const archiveContract    = (id)       => del(`/contracts/${id}`)
export const restoreContract    = (id)       => put(`/contracts/${id}/restore`)
export const destroyContract    = (id)       => del(`/contracts/${id}/permanent`)
// Contrôles annuels à deux mois ou moins : contrats à relever de 5 %.
export const getAnnualIncreases  = ()        => get('/contracts/annual-increases')
export const applyAnnualIncrease = (id, control) => post(`/contracts/${id}/increase`, { control })

/** Montant en dinars, millimes compris quand il y en a. */
export function formatPrice(n) {
  if (n == null || n === '') return '—'
  return `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} DT`
}

/* Durées proposées pour chaque renouvellement, en mois. */
export const RENEWAL_DURATIONS = [
  { value: 6,  label: '6 mois' },
  { value: 12, label: '1 an' },
  { value: 24, label: '2 ans' },
  { value: 36, label: '3 ans' },
]

export function renewalLabel(months) {
  const d = RENEWAL_DURATIONS.find(r => r.value === Number(months))
  if (d) return d.label
  return `${months} mois`
}

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
