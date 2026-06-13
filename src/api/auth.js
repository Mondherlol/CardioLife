import { post, get } from './http'

export const login = (username, password) => post('/auth/login', { username, password })
export const me    = ()                   => get('/auth/me')
