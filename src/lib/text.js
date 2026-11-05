/**
 * Comparaison de textes tolérante pour les filtres de recherche : minuscules,
 * sans accents. « lycee » trouve « LYCÉE », « ecole » trouve « École ».
 * Miroir de `backend/utils/textSearch.js` (`fold`).
 */
export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
}

/** `text` contient-il `query` (déjà replié ou non), accents et casse ignorés ? */
export function matchesText(text, query) {
  return fold(text).includes(fold(query))
}
