/**
 * Brouillon local d'un bon d'intervention.
 *
 * Un onglet mis en arrière-plan peut être déchargé par le navigateur
 * (économiseur de mémoire de Chrome, tablettes, téléphones) : au retour, la
 * page se recharge et repart de la version enregistrée. Tout ce qui avait été
 * saisi sans « Enregistrer » disparaissait. Le brouillon garde la saisie en
 * cours dans le navigateur, jusqu'à l'enregistrement.
 *
 * `kind` distingue un bon d'intervention d'un bon de formation : les deux
 * n'ont pas d'identifiants communs, mais autant ne rien laisser au hasard.
 */
const PREFIX = 'cardiotrack:bon-draft:'
// Au-delà, le brouillon est plus vieux que ce qu'on est en train de reprendre.
const MAX_AGE_MS = 14 * 24 * 3600 * 1000

const keyOf = (kind, id) => `${PREFIX}${kind}:${id}`

export function loadDraft(kind, id) {
  try {
    const raw = localStorage.getItem(keyOf(kind, id))
    if (!raw) return null
    const { bon, at } = JSON.parse(raw)
    if (!bon || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(keyOf(kind, id))
      return null
    }
    return bon
  } catch {
    return null
  }
}

/** Garde `bon` tant qu'il diffère de la version enregistrée ; l'efface sinon. */
export function syncDraft(kind, id, bon, saved) {
  try {
    if (!bon || JSON.stringify(bon) === JSON.stringify(saved)) {
      localStorage.removeItem(keyOf(kind, id))
    } else {
      localStorage.setItem(keyOf(kind, id), JSON.stringify({ bon, at: Date.now() }))
    }
  } catch { /* stockage indisponible (navigation privée) : rien à faire */ }
}

export function clearDraft(kind, id) {
  try { localStorage.removeItem(keyOf(kind, id)) } catch { /* idem */ }
}
