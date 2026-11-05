/**
 * Recherche plein texte tolérante : « lycee » trouve « LYCÉE », « ecole »
 * trouve « École ». Les noms de clients et de sites sont saisis avec ou sans
 * accents selon qui les tape ; la recherche ne doit pas en dépendre.
 */

/* Variantes accentuées de chaque lettre, majuscules comprises : l'option `i`
   de MongoDB ne replie pas toujours la casse des lettres accentuées. */
const VARIANTS = {
  a: 'aàâäáãåAÀÂÄÁÃÅ',
  c: 'cçCÇ',
  e: 'eéèêëEÉÈÊË',
  i: 'iîïíìIÎÏÍÌ',
  n: 'nñNÑ',
  o: 'oôöóòõOÔÖÓÒÕ',
  u: 'uùûüúUÙÛÜÚ',
  y: 'yÿýYŸÝ',
}

/** Minuscules sans accents — pour comparer deux textes en JavaScript. */
function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
}

const escapeChar = c => c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')

/**
 * Source d'expression régulière insensible aux accents pour `text`. Les
 * caractères spéciaux sont neutralisés : « c++ » se cherche tel quel.
 */
function accentPattern(text) {
  let out = ''
  for (const ch of fold(String(text || '').trim())) {
    const v = VARIANTS[ch]
    out += v ? `[${v}]` : escapeChar(ch)
  }
  // « oe » saisi trouve aussi « œ ».
  return out.replace(/\[oôöóòõOÔÖÓÒÕ\]\[eéèêëEÉÈÊË\]/g, m => `(?:${m}|[œŒ])`)
}

/** Filtre Mongo `{ $regex, $options }`, ou `null` sans texte. */
function searchRegex(text) {
  const p = accentPattern(text)
  return p ? { $regex: p, $options: 'i' } : null
}

/** Même chose en `RegExp`, pour les `$in` et les filtres en mémoire. */
function searchRegExp(text, { anchored = false } = {}) {
  const p = accentPattern(text)
  return p ? new RegExp(anchored ? `^${p}` : p, 'i') : null
}

module.exports = { fold, accentPattern, searchRegex, searchRegExp }
