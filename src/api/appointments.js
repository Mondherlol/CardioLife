import { get, post, put, del } from './http'

export const getAppointments  = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return get(`/appointments${qs ? `?${qs}` : ''}`)
}
export const createAppointment = (data)     => post('/appointments', data)
export const updateAppointment = (id, data) => put(`/appointments/${id}`, data)
export const deleteAppointment = (id)       => del(`/appointments/${id}`)
