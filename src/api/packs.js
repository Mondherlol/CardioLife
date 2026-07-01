import { get, post, put, del } from './http'

export const getPacks = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/packs${qs ? `?${qs}` : ''}`)
}
export const getPack       = (id)       => get(`/packs/${id}`)
export const createPack    = (data)     => post('/packs', data)
export const updatePack    = (id, data) => put(`/packs/${id}`, data)
export const archivePack   = (id)       => del(`/packs/${id}`)
export const restorePack   = (id)       => put(`/packs/${id}/restore`)
export const destroyPack   = (id)       => del(`/packs/${id}/permanent`)

// Prix théorique = somme (prix de vente × quantité) des produits + prix des services.
export function computeTheoreticalPrice(pack) {
  const productsTotal = (pack.products || []).reduce((sum, item) => {
    const price = Number(item.product?.salePrice) || 0
    const qty   = Number(item.quantity) || 1
    return sum + price * qty
  }, 0)
  const servicesTotal = (pack.services || []).reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  return productsTotal + servicesTotal
}
