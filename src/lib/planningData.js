import { getAppointments } from '../api/appointments'
import { getFormations } from '../api/formations'
import { getInterventions } from '../api/interventions'
import { getInstallations } from '../api/installations'
import { DEDICATED_TYPES, CONTROL_TYPES, controlTypeToPlanning, controlEventTitle } from './appointmentConstants'

/**
 * Récupère et normalise tous les événements du planning sur une plage de dates.
 * Mêmes sources que la page Planning : rendez-vous, contrôles (interventions),
 * poses (installations « à installer ») et formations.
 *
 * @param {Object} p
 * @param {string} p.from        ISO début de plage
 * @param {string} p.to          ISO fin de plage
 * @param {string|null} p.typeFilter  filtre optionnel sur le type
 * @returns {Promise<Array>} items { id, kind, type, title, start, end, allDay, clientName, status, raw }
 */
export async function fetchPlanningItems({ from, to, typeFilter = null }) {
  const isDedicated = t => DEDICATED_TYPES.includes(t)
  const wantAppt = !typeFilter || !isDedicated(typeFilter)
  const wantIntv = !typeFilter || CONTROL_TYPES.includes(typeFilter)
  const wantInst = !typeFilter || typeFilter === 'installation'
  const wantFmn  = !typeFilter || typeFilter === 'formation'

  const [appts, intvs, instRes, fmns] = await Promise.all([
    wantAppt
      ? getAppointments({
          start: from, end: to,
          ...(typeFilter && !isDedicated(typeFilter) ? { type: typeFilter } : {}),
        }).catch(() => [])
      : Promise.resolve([]),
    wantIntv ? getInterventions({ from, to }).catch(() => []) : Promise.resolve([]),
    wantInst ? getInstallations({ status: 'a_installer', from, to }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    wantFmn  ? getFormations({ from, to }).catch(() => []) : Promise.resolve([]),
  ])

  const insts = Array.isArray(instRes) ? instRes : (instRes?.data || [])
  const items = []

  for (const a of (Array.isArray(appts) ? appts : [])) {
    items.push({
      id: a._id, kind: 'appointment', type: a.type, title: a.title,
      start: a.start, end: a.end, allDay: a.allDay,
      clientName: a.clientName, status: a.status, raw: a,
    })
  }
  for (const i of (Array.isArray(intvs) ? intvs : [])) {
    if (!i.scheduledDate) continue
    items.push({
      id: i._id, kind: 'intervention', type: controlTypeToPlanning(i.controlType),
      title: controlEventTitle(i),
      start: i.scheduledDate, clientName: i.clientName, status: i.status, raw: i,
    })
  }
  for (const i of insts) {
    if (!i.scheduledDate) continue
    items.push({
      id: i._id, kind: 'installation', type: 'installation',
      title: `Installation${i.clientName ? ' — ' + i.clientName : ''}`,
      start: i.scheduledDate, clientName: i.clientName, status: i.status, raw: i,
    })
  }
  for (const f of (Array.isArray(fmns) ? fmns : [])) {
    items.push({
      id: f._id, kind: 'formation', type: 'formation', title: f.title,
      start: f.date, end: f.end, clientName: f.clientName, status: f.status, raw: f,
    })
  }

  return items
}
