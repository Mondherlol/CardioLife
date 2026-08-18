/**
 * Remise en état du catalogue repris du site vitrine.
 *
 * Les fiches sont nées d'un scraping : la description est du HTML WordPress, la
 * référence est l'adresse de la page, le « mode » a été deviné en cherchant le
 * mot « automatique » n'importe où dans le texte — si bien qu'une armoire est
 * semi-automatique — et la catégorie vient des rayons du site, où électrodes et
 * kits de secours voisinent avec les batteries.
 *
 * Ce module ne décide rien tout seul : il dit ce qui cloche et ce qu'il
 * proposerait. Les appelants — l'export Excel et le script de reprise — en
 * font ce qu'ils veulent.
 */

/* ── HTML → texte lisible ─────────────────────────────────────── */

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', ldquo: '«', rdquo: '»', hellip: '…',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç',
  ugrave: 'ù', ocirc: 'ô', icirc: 'î', laquo: '«', raquo: '»',
  deg: '°', euro: '€', times: '×', middot: '·', ndash: '–', mdash: '—',
  bull: '•', reg: '®', copy: '©', trade: '™',
}

function decodeEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,          (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
}

/**
 * Description HTML rendue en texte lisible dans une cellule Excel.
 *
 * La mise en forme n'est pas jetée, elle est traduite : les paragraphes
 * deviennent des lignes, les puces gardent leur tiret. Une liste à plat serait
 * illisible, et c'est précisément la partie utile de ces fiches.
 */
function htmlToText(html) {
  if (!html) return ''
  const str = String(html)
  // Pas la moindre balise : c'est déjà du texte, on n'y touche pas.
  if (!/<[a-z/!]/i.test(str)) return str.replace(/[ \t]+\n/g, '\n').trim()

  /* Le CMS met déjà des retours à la ligne autour de ses balises : les avaler
     avec la balise évite qu'un simple <br> ne devienne un paragraphe. */
  let out = str
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]*<br\s*\/?>[ \t]*\n?/gi, '\n')
    .replace(/\n?[ \t]*<\/(p|div|h[1-6]|tr)>[ \t]*\n?/gi, '\n\n')
    .replace(/\n?[ \t]*<li[^>]*>[ \t]*/gi, '\n• ')
    .replace(/\n?[ \t]*<\/(ul|ol|table)>[ \t]*\n?/gi, '\n\n')
    .replace(/<[^>]+>/g, '')

  out = decodeEntities(out)

  return out
    .replace(/ /g, ' ')          // espace insécable venu du CMS
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n• *\n/g, '\n')        // puce restée vide
    .trim()
}

/* ── Référence ────────────────────────────────────────────────── */

/** Référence fabriquée par le scraping à partir de l'URL de la page. */
function isScrapeReference(ref) {
  return /^cardiolife:/i.test(String(ref || '').trim())
}

/** Le slug caché dans une référence de scraping, pour le garder ailleurs. */
function scrapeSlug(ref) {
  return String(ref || '').trim().replace(/^cardiolife:/i, '')
}

/* ── Nature du produit ────────────────────────────────────────── */

/**
 * Ce qu'est réellement le produit, quel que soit le rayon où le site l'avait
 * rangé. Le nom est le juge : « Electrode adulte POWERHEART G3 » est une
 * électrode, même classée dans les batteries.
 */
function productKind(name = '', categoryLabel = '') {
  const n = `${name}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const c = `${categoryLabel}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

  // Un appareil de formation n'est pas un défibrillateur : il ne choque pas, il
  // ne se contrôle pas, et le compter dans le parc fausserait tout.
  if (/\b(formation|trainer|entrainement)\b/.test(n)) return 'formation'

  if (/electrode|padz|pad-?z/.test(n))              return 'electrodes'
  if (/^kit |kit de (premiers )?secours/.test(n))   return 'kit'
  if (/batterie|pile\b|piles\b|accu\b/.test(n))     return 'batterie'
  if (/armoire|boitier|support mural|coffret/.test(n)) return 'armoire'
  if (/sacoche|housse|mallette/.test(n))            return 'accessoire'
  if (/mannequin/.test(n))                          return 'accessoire'
  if (/signaletique|panneau|autocollant|sticker/.test(n)) return 'signaletique'
  if (/defibrillateur|\bdae\b|\baed\b|powerheart|zoll/.test(n)) return 'defibrillateur'

  // Le nom ne dit rien : on s'en remet au rayon d'origine.
  if (/electrode/.test(c))      return 'electrodes'
  if (/batterie/.test(c))       return 'batterie'
  if (/armoire/.test(c))        return 'armoire'
  if (/signaletique/.test(c))   return 'signaletique'
  if (/defibrillateur/.test(c)) return 'defibrillateur'
  return 'autre'
}

/** Rayon qui convient à cette nature, parmi ceux du catalogue. */
const KIND_CATEGORY = {
  electrodes:     ['electrode'],
  batterie:       ['batterie', 'pile'],
  defibrillateur: ['defibrillateur', 'dae'],
  armoire:        ['armoire', 'boitier'],
  signaletique:   ['signaletique'],
  kit:            ['kit', 'secours', 'autre'],
  formation:      ['formation', 'autre'],
  accessoire:     ['accessoire', 'autre'],
  autre:          ['autre'],
}

/**
 * Traçabilité attendue : un défibrillateur se suit à l'exemplaire par son
 * numéro de série, un consommable à péremption se suit par lot. Une sacoche ne
 * se suit pas — lui coller un numéro de série n'apporte que de la saisie.
 */
function expectedTracking(kind) {
  if (kind === 'defibrillateur') return { requiresSerialNumber: true,  requiresLotNumber: false }
  if (['electrodes', 'batterie', 'kit'].includes(kind))
    return { requiresSerialNumber: false, requiresLotNumber: true }
  return { requiresSerialNumber: false, requiresLotNumber: false }
}

/** Le mode ne veut dire quelque chose que sur un appareil qui délivre un choc. */
function modeApplies(kind) {
  return kind === 'defibrillateur' || kind === 'formation'
}

/* ── Saisies d'essai ──────────────────────────────────────────── */

/**
 * Fiche visiblement tapée pour tester l'écran : suite de touches, marque
 * fantaisiste, rien d'autre de rempli. On ne les supprime pas d'office — c'est
 * au propriétaire du catalogue de trancher — mais on les signale.
 */
function looksLikeTestRecord({ name = '', brand = '', reference = '', description = '' }) {
  const gibberish = s => {
    const v = String(s || '').trim().toLowerCase()
    if (v.length < 3 || v.length > 12) return false
    if (!/^[a-z]+$/.test(v)) return false
    // Aucune voyelle, ou la même lettre répétée : personne n'écrit ça.
    return !/[aeiouy]/.test(v) || /^(.)\1+$/.test(v)
  }
  const empty = !description && !reference.match(/[a-z]{3}/i)
  return gibberish(name) || (gibberish(brand) && empty)
}

module.exports = {
  htmlToText, decodeEntities,
  isScrapeReference, scrapeSlug,
  productKind, expectedTracking, modeApplies, KIND_CATEGORY,
  looksLikeTestRecord,
}
