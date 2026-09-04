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
// Marque l'arrivée sur site : c'est ce clic qui déverrouille la checklist.
export const startIntervention  = (id)        => patch(`/interventions/${id}/start`, {})
export const closeIntervention  = (id)        => patch(`/interventions/${id}/close`, {})
/* Rouvre une visite clôturée : la checklist redevient saisissable et la
   réouverture est tracée dans l'historique. */
export const reopenIntervention = (id, motif) => patch(`/interventions/${id}/reopen`, { motif })

/* Batterie / électrodes montées sur le DAE, identifiées depuis la checklist :
   elles vont au parc du site, pas dans la fiche d'intervention. */
export const saveDeaItems = (id, kind, dea, items) =>
  put(`/interventions/${id}/dea-items/${kind}`, { dea: dea || undefined, items })

/* Sort de la formation des agents : `etat` vaut 'effectuee', 'reportee' ou
   'non_prevue'. La séance concernée suit — date déplacée, statut confirmé. */
export const saveFormationOutcome = (id, data) =>
  patch(`/interventions/${id}/formation`, data)

/* Bon d'intervention : nature du passage et signature recueillie sur place. */
export const saveBon = (id, data) => patch(`/interventions/${id}/bon`, data)

export const uploadFichePhoto = (id, file, deaId) => {
  const form = new FormData()
  form.append('photo', file)
  if (deaId) form.append('dea', deaId)
  return upload(`/interventions/${id}/photo`, form)
}
export const deleteFichePhoto = (id, filename) => del(`/interventions/${id}/photo/${filename}`)
export const fichePhotoUrl    = (filename) => `${STATIC_BASE}/uploads/interventions/${filename}`
