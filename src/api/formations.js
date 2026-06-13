import { get, put, patch, del, upload } from './http'
export { STATIC_BASE } from './http'

export const getFormationsByClient  = (clientId)       => get(`/formations/client/${clientId}`)
export const createFormation        = (formData)        => upload('/formations', formData)
export const updateFormation        = (id, data)        => put(`/formations/${id}`, data)
export const toggleAttestation      = (id)              => patch(`/formations/${id}/attestation`, {})
export const addDocuments           = (id, formData)    => upload(`/formations/${id}/documents`, formData)
export const removeDocument         = (id, docId)       => del(`/formations/${id}/documents/${docId}`)
export const deleteFormation        = (id)              => del(`/formations/${id}`)
