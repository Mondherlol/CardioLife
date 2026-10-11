/**
 * Mémoire du planning, le temps de la session.
 *
 * Ouvrir un contrôle depuis le planning puis revenir rechargeait tout : cinq
 * requêtes, un calendrier vide le temps qu'elles répondent, et la vue repartait
 * du mois en cours. On garde donc ici, au niveau du module (il survit au
 * changement de page) :
 *  - les données déjà chargées, par période affichée — montrées tout de suite,
 *    puis revérifiées en arrière-plan ;
 *  - la vue (mois / semaine / jour / liste), la date affichée et le filtre ;
 *  - la colonne de gauche (aujourd'hui, prochains contrôles, en attente).
 */

// Une période revérifiée il y a moins de 30 s s'affiche sans requête.
export const FRESH_MS = 30000

const ranges = new Map()        // 'début|fin' → { data, sig, at }

export const rangeKey = info => `${info.startStr}|${info.endStr}`
export const getRange = key => ranges.get(key)
export function setRange(key, data) {
  const sig = JSON.stringify(data)
  const prev = ranges.get(key)
  ranges.set(key, { data, sig, at: Date.now() })
  return !prev || prev.sig !== sig
}
/* Retour sur la page : on montre ce qu'on a, mais tout sera revérifié. */
export function markAllStale() {
  for (const v of ranges.values()) v.at = 0
}
/* Après une modification faite depuis le planning : on repart du serveur. */
export function clearRanges() { ranges.clear() }

/* Colonne de gauche : dernières valeurs connues. */
export const side = { today: null, upcoming: null, attenteCount: 0 }

/* Vue, date et filtre : dans la session de l'onglet. */
const VIEW_KEY = 'cardiotrack:planning-view'
export function loadView() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || {} } catch { return {} }
}
export function saveView(patch) {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...loadView(), ...patch })) } catch { /* rien */ }
}
