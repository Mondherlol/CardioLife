import { get, post, patch, del } from './http'

/* Libellés et tonalités des statuts — partagés par le tableau, le panneau
   latéral et la fiche article pour qu'un même état s'affiche pareil partout. */
export const ITEM_STATUSES = [
  { value: 'disponible',  label: 'Disponible',     tone: 'mint'  },
  { value: 'reserve',     label: 'Réservé',        tone: 'sky'   },
  { value: 'maintenance', label: 'En maintenance', tone: 'sun'   },
  { value: 'installe',    label: 'Installé',       tone: 'slate' },
  { value: 'vendu',       label: 'Vendu',          tone: 'slate' },
  { value: 'hs',          label: 'Hors service',   tone: 'ember' },
]

export const itemStatus = (value) =>
  ITEM_STATUSES.find(s => s.value === value) || { value, label: value, tone: 'slate' }

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)
  ).toString()
  return s ? `?${s}` : ''
}

export const getProductItems  = (params = {}) => get(`/product-items${qs(params)}`)
export const getStockModels   = (params = {}) => get(`/product-items/models${qs(params)}`)
export const getProductItem   = (id)          => get(`/product-items/${id}`)
export const createProductItems = (data)      => post('/product-items', data)
export const updateProductItem  = (id, data)  => patch(`/product-items/${id}`, data)
export const setItemStatus      = (id, data)  => post(`/product-items/${id}/status`, data)
export const deleteProductItem  = (id)        => del(`/product-items/${id}`)
