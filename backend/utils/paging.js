/**
 * Découpage d'une liste paginée.
 *
 * Deux façons de demander un lot : `skip` explicite — les listes chargées au
 * fil du défilement demandent « les 30 suivants après les 60 déjà affichés » —
 * ou l'ancien `page`, gardé pour les appelants qui en dépendent encore.
 * `limit` est borné : une liste se charge par lots, pas d'un bloc.
 */
function pageParams(query = {}, { defaultLimit = 20, maxLimit = 1000 } = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), maxLimit)
  const skip  = query.skip !== undefined
    ? Math.max(Number(query.skip) || 0, 0)
    : (Math.max(Number(query.page) || 1, 1) - 1) * limit
  return { skip, limit, page: Math.floor(skip / limit) + 1 }
}

/** Réponse paginée commune : `hasMore` dit s'il reste un lot à charger. */
function pageResult(data, total, { skip, limit, page }) {
  return {
    data,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    hasMore:    skip + data.length < total,
  }
}

/** Texte de recherche → regex insensible à la casse, caractères spéciaux neutralisés. */
function searchRegex(text) {
  const q = String(text || '').trim()
  if (!q) return null
  return { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
}

module.exports = { pageParams, pageResult, searchRegex }
