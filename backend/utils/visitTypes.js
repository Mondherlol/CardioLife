/**
 * Types de visite (`Intervention.controlType`).
 *
 * Les contrôles (semestriel, annuel, hors contrat) font l'échéance du site.
 * Les deux autres suivent le même circuit — planning, démarrage, checklist,
 * photos, bon signé, rapport — sans jamais en valoir une :
 *  - `intervention` : passage ponctuel (remplacement, dépannage) ;
 *  - `installation` : pose d'un ou plusieurs DAE réservés au client.
 *
 * Toute requête qui cherche « le prochain contrôle » exclut donc ces deux
 * types : une pose prévue mardi n'est pas le contrôle du site.
 */

const CONTROL_TYPES     = ['semestriel', 'annuel', 'hors_contrat']
const NON_CONTROL_TYPES = ['intervention', 'installation']
const VISIT_TYPES       = [...CONTROL_TYPES, ...NON_CONTROL_TYPES]

const VISIT_TYPE_LABELS = {
  semestriel:   'Contrôle semestriel',
  annuel:       'Contrôle annuel',
  hors_contrat: 'Contrôle hors contrat',
  intervention: 'Intervention',
  installation: 'Installation',
}

/** Filtre Mongo : uniquement les visites qui valent contrôle. */
const ONLY_CONTROLS = { $nin: NON_CONTROL_TYPES }

module.exports = { CONTROL_TYPES, NON_CONTROL_TYPES, VISIT_TYPES, VISIT_TYPE_LABELS, ONLY_CONTROLS }
