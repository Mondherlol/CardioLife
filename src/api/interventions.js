import { get, post, put, patch, del } from './http'

export const getInterventions  = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/interventions${qs ? `?${qs}` : ''}`)
}
export const getIntervention   = (id)       => get(`/interventions/${id}`)
export const createIntervention = (data)    => post('/interventions', data)
export const updateIntervention = (id, data) => put(`/interventions/${id}`, data)
export const submitRapport      = (id, data) => patch(`/interventions/${id}/rapport`, data)
export const deleteIntervention = (id)      => del(`/interventions/${id}`)
