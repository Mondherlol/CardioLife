import { get, post, put, del } from './http'

export const getProductCategories = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/product-categories${qs ? `?${qs}` : ''}`)
}
export const createProductCategory  = (data)     => post('/product-categories', data)
export const updateProductCategory  = (id, data) => put(`/product-categories/${id}`, data)
export const deleteProductCategory  = (id)       => del(`/product-categories/${id}`)
export const reorderProductCategories = (ids)    => put('/product-categories/reorder', { ids })
