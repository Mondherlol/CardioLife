import { get, post, put, del } from './http'

export const getSites   = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/sites${qs ? `?${qs}` : ''}`)
}
/* Sites d'un client réduits à l'essentiel (nom, adresse, parc) — accessible
   sans le droit de gestion des clients : sert à désigner un lieu de visite. */
export const lookupSites = (clientId) => get(`/sites/lookup?client=${clientId}`)
/* Parc des DEA à plat (un objet par appareil posé), tous clients confondus. */
export const getDeas = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/sites/deas${qs ? `?${qs}` : ''}`)
}
export const getSite    = (id)       => get(`/sites/${id}`)
/* Fiche complète d'un site : parc, formations, contrôles, consommables, quota. */
export const getSiteHistory        = (id) => get(`/sites/${id}/history`)
export const getSiteDocumentsFolder = (id) => get(`/sites/${id}/documents-folder`)
export const createSite = (data)     => post('/sites', data)
export const updateSite = (id, data) => put(`/sites/${id}`, data)
export const deleteSite = (id)       => del(`/sites/${id}`)

export const addDea    = (siteId, data)        => post(`/sites/${siteId}/deas`, data)
export const updateDea = (siteId, deaId, data) => put(`/sites/${siteId}/deas/${deaId}`, data)
export const deleteDea = (siteId, deaId)       => del(`/sites/${siteId}/deas/${deaId}`)
