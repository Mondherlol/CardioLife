import { get, post, put, del } from './http'

export const getControlsByInstallation = (installId) => get(`/controls/installation/${installId}`)
export const getControlsByClient       = (clientId)  => get(`/controls/client/${clientId}`)
export const createControl = (data)     => post('/controls', data)
export const updateControl = (id, data) => put(`/controls/${id}`, data)
export const deleteControl = (id)       => del(`/controls/${id}`)
