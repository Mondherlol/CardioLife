import { get, post, del } from './http'

export const getClientTypes   = ()          => get('/client-types')
export const createClientType = (name)      => post('/client-types', { name })
export const deleteClientType = (id)        => del(`/client-types/${id}`)
