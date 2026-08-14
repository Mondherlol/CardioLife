import { get, put, post } from './http'

export const getAppSettings    = ()    => get('/app-settings')
export const updateAppSettings = (data) => put('/app-settings', data)

/* Remise à zéro des données métier — les comptes utilisateurs sont conservés.
   `confirm` doit valoir « REINITIALISER », le serveur refuse sans. */
export const resetDatabase = (payload) => post('/app-settings/reset', payload)
