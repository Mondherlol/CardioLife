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

const DEFIB = 'defibrillateur'
const BATTERY = 'batterie'
const ELECTRODES = ['electrodes_adulte', 'electrodes_enfant']

/**
 * Développe un pack (produits peuplés) en brouillons d'installations :
 * 1 installation par unité de défibrillateur ; batteries & électrodes du pack
 * réparties en round-robin sur ces installations. Les services sont ignorés ici.
 * Retourne [] si le pack ne contient aucun défibrillateur.
 */
export function expandToInstallations(products, sourceName) {
  const items = products || []
  const defibUnits = []
  items.filter(i => i.product?.category === DEFIB).forEach(i => {
    const qty = Number(i.quantity) || 1
    for (let k = 0; k < qty; k++) {
      defibUnits.push({
        _key: `${Math.random()}`,
        deviceProduct: i.product._id,
        deviceType:    i.product.name,
        source:        sourceName || '',
        batteries: [],
        electrodes: [],
      })
    }
  })
  if (defibUnits.length === 0) return []

  // Répartition round-robin des batteries
  let idx = 0
  items.filter(i => i.product?.category === BATTERY).forEach(i => {
    const qty = Number(i.quantity) || 1
    for (let k = 0; k < qty; k++) {
      defibUnits[idx % defibUnits.length].batteries.push({
        product: i.product._id, productName: i.product.name,
      })
      idx++
    }
  })
  idx = 0
  items.filter(i => ELECTRODES.includes(i.product?.category)).forEach(i => {
    const qty = Number(i.quantity) || 1
    for (let k = 0; k < qty; k++) {
      defibUnits[idx % defibUnits.length].electrodes.push({
        product: i.product._id, productName: i.product.name,
      })
      idx++
    }
  })
  return defibUnits
}
