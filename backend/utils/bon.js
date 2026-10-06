const { BON_NATURES } = require('../models/Intervention')

/**
 * Applique au `bon` d'une intervention ou d'une formation les réglages reçus
 * de l'écran du bon. Lève une erreur `status: 400` sur une nature inconnue.
 */
function applyBon(target, body) {
  const { nature, signataire, reference, bonCommande, designations } = body
  // Une nature seule (ancien client) vaut une liste d'un élément.
  const natures = nature === undefined ? undefined
    : [...new Set((Array.isArray(nature) ? nature : [nature]).filter(Boolean))]
  if (natures && !natures.every(n => BON_NATURES.includes(n))) {
    const err = new Error("Nature d'intervention inconnue.")
    err.status = 400
    throw err
  }

  if (!target.bon) target.bon = {}
  if (reference !== undefined) target.bon.reference = String(reference).trim()
  if (bonCommande !== undefined) target.bon.bonCommande = String(bonCommande).trim()
  if (natures) target.bon.nature = natures
  if (designations !== undefined) {
    // Texte vide = retour au libellé par défaut : on n'en garde pas la trace.
    const clean = Object.entries(designations && typeof designations === 'object' ? designations : {})
      .filter(([k, v]) => /^[\w-]+\|[\w-]+$/.test(k) && typeof v === 'string' && v.trim())
      .map(([k, v]) => [k, v.trim().slice(0, 1000)])
    target.bon.designations = clean.length ? new Map(clean) : undefined
  }
  if (signataire !== undefined) {
    target.bon.signataire = signataire
    // La signature vaut à la date où elle est recueillie, pas à l'impression.
    target.bon.signedAt = signataire ? new Date() : undefined
  }
  target.markModified('bon')
}

module.exports = { applyBon }
