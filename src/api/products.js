import { get, post, put, patch, del, upload, STATIC_BASE } from './http'

export function productImageUrl(filename) {
  return `${STATIC_BASE}/uploads/products/${filename}`
}

export const getProducts      = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/products${qs ? `?${qs}` : ''}`)
}
export const getAllMovements  = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/movements${qs ? `?${qs}` : ''}`)
}
export const getProductStats  = ()         => get('/products/stats')
export const getSuppliers     = ()         => get('/products/suppliers')
export const getBrands        = ()         => get('/products/brands')
export const getProduct       = (id)       => get(`/products/${id}`)
export const getMovements     = (id)       => get(`/products/${id}/movements`)
export const getProductInstallations = (id) => get(`/products/${id}/installations`)
export const createProduct    = (data)     => post('/products', data)
export const updateProduct    = (id, data) => put(`/products/${id}`, data)
export const patchProduct     = (id, data) => patch(`/products/${id}`, data)
export const adjustStock      = (id, data) => post(`/products/${id}/stock`, data)
export const assignSerials    = (id, data) => post(`/products/${id}/serials`, data)
export const uploadProductImage = (id, file) => {
  const fd = new FormData()
  fd.append('image', file)
  return upload(`/products/${id}/images`, fd)
}
export const deleteProductImage = (id, filename) =>
  del(`/products/${id}/images/${encodeURIComponent(filename)}`)

export const archiveProduct   = (id)       => del(`/products/${id}`)
export const restoreProduct   = (id)       => put(`/products/${id}/restore`)
export const destroyProduct   = (id)       => del(`/products/${id}/permanent`)
