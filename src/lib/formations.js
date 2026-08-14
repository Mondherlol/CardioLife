/**
 * Vocabulaire commun des formations — fiche client, fiche site, planning et
 * onglet Maintenance parlent tous d'après ce module, pour que la même formation
 * s'y lise de la même façon.
 *
 * Le cycle réel tient en trois temps :
 *   Programmé          la séance est calée, les agents sont inscrits
 *   Terminé            la séance a eu lieu, les attestations restent à envoyer
 *   Terminé & livré    les attestations sont parties chez le responsable du site
 *
 * En base, ces trois temps s'écrivent avec deux champs (`status` +
 * `attestationDelivered`) hérités du modèle : `stageOf` les lit, `stagePayload`
 * les écrit. Aucun écran ne manipule ces deux champs directement.
 */

export const STAGES = {
  programme: { id: 'programme', label: 'Programmé',       short: 'Programmé', tone: 'blue'   },
  termine:   { id: 'termine',   label: 'Terminé',         short: 'Terminé',   tone: 'amber'  },
  livre:     { id: 'livre',     label: 'Terminé & livré', short: 'Livré',     tone: 'green'  },
  annule:    { id: 'annule',    label: 'Annulé',          short: 'Annulé',    tone: 'muted'  },
}

/* Ordre du cycle, tel qu'il s'affiche dans les sélecteurs. */
export const STAGE_LIST = [STAGES.programme, STAGES.termine, STAGES.livre, STAGES.annule]

export function stageOf(formation) {
  if (!formation) return STAGES.programme
  if (formation.status === 'annule') return STAGES.annule
  if (formation.status === 'fait') {
    return formation.attestationDelivered ? STAGES.livre : STAGES.termine
  }
  return STAGES.programme
}

/** Champs à enregistrer pour placer une formation à cette étape. */
export function stagePayload(stageId) {
  switch (stageId) {
    case 'livre':   return { status: 'fait',     attestationDelivered: true  }
    case 'termine': return { status: 'fait',     attestationDelivered: false }
    case 'annule':  return { status: 'annule',   attestationDelivered: false }
    default:        return { status: 'planifie', attestationDelivered: false }
  }
}

/* ── Participants ──────────────────────────────────────────────── */

export const PARTICIPANT_STATES = {
  a_former: { id: 'a_former', label: 'À former', tone: 'amber' },
  forme:    { id: 'forme',    label: 'Formé',    tone: 'green' },
  absent:   { id: 'absent',   label: 'Absent',   tone: 'muted' },
}

export const PARTICIPANT_LIST = [
  PARTICIPANT_STATES.a_former, PARTICIPANT_STATES.forme, PARTICIPANT_STATES.absent,
]

export function participantState(p) {
  return PARTICIPANT_STATES[p?.status] || PARTICIPANT_STATES.a_former
}

/** Décompte des inscrits par état — l'en-tête de chaque fiche s'en sert. */
export function countParticipants(formation) {
  const list = formation?.participants || []
  return {
    total:    list.length,
    forme:    list.filter(p => p.status === 'forme').length,
    a_former: list.filter(p => p.status === 'a_former').length,
    absent:   list.filter(p => p.status === 'absent').length,
  }
}

/**
 * Places consommées sur le droit du site. La liste nominative fait foi dès
 * qu'elle existe — c'est aussi la règle appliquée côté serveur.
 */
export function seatsUsed(formation) {
  if (formation?.status === 'annule') return 0
  const list = formation?.participants || []
  if (list.length) return list.filter(p => p.status !== 'absent').length
  return Number(formation?.participantsCount) || 0
}

/* ── Destinataire des attestations ─────────────────────────────── */

/**
 * À qui envoyer les attestations : le contact enregistré sur la formation,
 * sinon le responsable du site (premier contact), pour que la fiche soit
 * exploitable même sur les formations créées avant cette version.
 */
export function attestationRecipient(formation, site) {
  const own = formation?.attestationContact
  if (own && (own.name || own.email || own.phone)) return { ...own, fromSite: false }

  const fallback = (site?.contacts || formation?.site?.contacts || [])[0]
  if (fallback && (fallback.name || fallback.email || fallback.phone)) {
    return { ...fallback, fromSite: true }
  }
  return null
}

/* ── Divers ────────────────────────────────────────────────────── */

export const SEATS_PER_DEA = 16

export function fmtFormationDate(d, withTime = false) {
  if (!d) return '—'
  const date = new Date(d)
  const day  = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  if (!withTime) return day
  return `${day} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

/** Formations qui demandent encore une action, les plus urgentes d'abord. */
export function pendingFormations(formations = []) {
  const list = formations.filter(f => {
    const s = stageOf(f)
    return s.id === 'programme' || s.id === 'termine'
  })
  return list.sort((a, b) => new Date(a.date) - new Date(b.date))
}
