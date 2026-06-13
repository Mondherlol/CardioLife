import { get, put } from './http'

export const getAppSettings    = ()    => get('/app-settings')
export const updateAppSettings = (data) => put('/app-settings', data)
