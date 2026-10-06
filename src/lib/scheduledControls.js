import { getInterventions } from '../api/interventions'

/* Contrôles que le contrat du site génère tout seul, à une date théorique. */
export const PERIODIC_TYPES = ['semestriel', 'annuel']

export const CONTROL_LABELS = {
  semestriel:   'Contrôle semestriel',
  annuel:       'Contrôle annuel',
  hors_contrat: 'Contrôle hors contrat',
  intervention: 'Intervention',
}

/**
 * Un contrôle du contrat sans technicien : c'est une échéance, pas encore un
 * rendez-vous. Le planning le montre en pointillé tant que personne ne l'a
 * programmé. (`manualDate` ne peut pas servir de repère : l'import du parc le
 * pose sur toutes les dates reprises du fichier.)
 */
export function isToSchedule(iv) {
  return iv?.status === 'planifie'
    && PERIODIC_TYPES.includes(iv.controlType)
    && !iv.technicien
}

/** Contrôles restant à faire chez un client (interventions ponctuelles exclues), du plus proche au plus lointain. */
export async function pendingControlsOf(clientId) {
  const list = await getInterventions({ client: clientId })
  return (Array.isArray(list) ? list : [])
    .filter(i => i.status !== 'termine' && i.controlType !== 'intervention' && i.scheduledDate)
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
}

/** Le contrôle périodique du site qui tombe le plus près de `date`. */
export function nearestPeriodic(controls, siteId, date) {
  const t = new Date(date).getTime()
  return controls
    .filter(c => PERIODIC_TYPES.includes(c.controlType)
      && String(c.site?._id || c.site) === String(siteId))
    .sort((a, b) => Math.abs(new Date(a.scheduledDate) - t) - Math.abs(new Date(b.scheduledDate) - t))[0] || null
}

/** Date + heure locales (champs de formulaire) en ISO. */
export function joinDateTime(date, time) {
  return new Date(`${date}T${time || '09:00'}`).toISOString()
}

export function fmtDay(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—'
}
