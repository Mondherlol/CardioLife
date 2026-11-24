/**
 * Report d'une formation : à une nouvelle date, ou « date à définir ».
 *
 * Les deux chemins (la fiche formation, et l'issue « Reportée » cochée par le
 * technicien pendant une visite) passent par ici, pour que la séance dise la
 * même chose quel que soit l'écran d'où on l'a repoussée.
 */

const fmt = d => new Date(d).toLocaleDateString('fr-FR')

function parseDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function push(formation, action, userId, details) {
  formation.history.push({ action, by: userId, at: new Date(), details })
}

/** Une formation terminée ou annulée n'a plus rien à reporter. */
function isClosed(formation) {
  return ['fait', 'annule'].includes(formation.status)
}

/**
 * Met la séance en attente d'une date. Elle reste due : statut « Programmé »,
 * mais hors du calendrier. Rappelée sur une formation déjà en attente, elle
 * met à jour le motif et la date de relance.
 */
function putOnHold(formation, { motif, relanceDate } = {}, userId) {
  const already = Boolean(formation.enAttente)
  const relance = parseDate(relanceDate)
  const why     = String(motif || '').trim()

  formation.enAttente    = true
  formation.attenteSince = formation.attenteSince || new Date()
  formation.status       = 'planifie'
  if (why || !already) formation.attenteMotif = why || undefined
  formation.relanceDate  = relance || undefined

  const details = [
    why,
    relance && `relance le ${fmt(relance)}`,
    !already && formation.date && `initialement prévue le ${fmt(formation.date)}`,
  ].filter(Boolean).join(' — ')
  push(formation, already ? 'Report mis à jour' : 'Formation reportée — date à définir', userId, details || undefined)
}

/**
 * Donne une date à la séance (qu'elle soit en attente ou non) : elle revient
 * au calendrier, sa durée est conservée.
 */
function reschedule(formation, { date, end } = {}, userId) {
  const start = parseDate(date)
  if (!start) return false

  const before   = formation.date
  const duration = formation.end && formation.date
    ? new Date(formation.end).getTime() - new Date(formation.date).getTime()
    : null
  const wasOnHold = Boolean(formation.enAttente)

  formation.date = start
  const until = parseDate(end)
  formation.end = until || (duration && duration > 0 ? new Date(start.getTime() + duration) : formation.end)
  formation.status = 'planifie'
  clearHold(formation)

  push(formation, wasOnHold ? 'Formation reprogrammée (sortie de l\'attente)' : 'Formation reportée',
    userId, `${before ? `${fmt(before)} → ` : ''}${fmt(start)}`)
  return true
}

function clearHold(formation) {
  formation.enAttente    = false
  formation.attenteSince = undefined
  formation.attenteMotif = undefined
  formation.relanceDate  = undefined
}

module.exports = { putOnHold, reschedule, clearHold, isClosed, parseDate }
