import { get, post, put, del } from './http'

export const getInstallations  = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/installations${qs ? `?${qs}` : ''}`)
}
export const getInstallation   = (id)       => get(`/installations/${id}`)
export const createInstallation = (data)    => post('/installations', data)
export const updateInstallation = (id, data) => put(`/installations/${id}`, data)
export const deleteInstallation = (id)      => del(`/installations/${id}`)
