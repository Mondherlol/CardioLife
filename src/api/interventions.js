import { get, post, put, patch, del, upload, STATIC_BASE } from './http'

export const getInterventions  = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/interventions${qs ? `?${qs}` : ''}`)
}
export const getIntervention    = (id)        => get(`/interventions/${id}`)
export const createIntervention = (data)      => post('/interventions', data)
export const updateIntervention = (id, data)  => put(`/interventions/${id}`, data)
export const submitRapport      = (id, data)  => patch(`/interventions/${id}/rapport`, data)
export const deleteIntervention = (id)        => del(`/interventions/${id}`)

/* Une visite couvre plusieurs DAE : `dea` dit de quelle fiche il s'agit.
   Les champs de visite (visa, réception, observation générale) s'envoient sans. */
export const saveFiche          = (id, data)  => patch(`/interventions/${id}/fiche`, data)
export const removeFiche        = (id, deaId) => del(`/interventions/${id}/fiche/${deaId || 'none'}`)
export const closeIntervention  = (id)        => patch(`/interventions/${id}/close`, {})

export const uploadFichePhoto = (id, file, deaId) => {
  const form = new FormData()
  form.append('photo', file)
  if (deaId) form.append('dea', deaId)
  return upload(`/interventions/${id}/photo`, form)
}
export const deleteFichePhoto = (id, filename) => del(`/interventions/${id}/photo/${filename}`)
export const fichePhotoUrl    = (filename) => `${STATIC_BASE}/uploads/interventions/${filename}`
