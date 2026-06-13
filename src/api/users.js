import { get, post, put, del } from './http'

export const getUsers          = ()               => get('/users')
export const getUser           = (id)             => get(`/users/${id}`)
export const createUser        = (data)           => post('/users', data)
export const updateUser        = (id, data)       => put(`/users/${id}`, data)
export const resetUserPassword = (id, password)   => put(`/users/${id}/reset-password`, { newPassword: password })
export const deleteUser        = (id)             => del(`/users/${id}`)
