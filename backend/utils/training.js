/**
 * Droit à formation du client : chaque DAE posé ouvre droit à 16 places de
 * formation. Le crédit se calcule au niveau du site, puisque c'est là que
 * vivent les DAE, et se consomme au fil des formations réalisées.
 */
const SEATS_PER_DEA = 16

/** Une formation annulée ne consomme rien. */
function seatsUsedBy(formation) {
  if (formation.status === 'annule') return 0
  return Number(formation.participantsCount) || 0
}

/**
 * @param deaCount    nombre de DAE du site (les poses planifiées comptent :
 *                    le droit naît du contrat, pas de la date de pose)
 * @param formations  formations rattachées au site
 */
function trainingQuota(deaCount, formations = []) {
  const credit = deaCount * SEATS_PER_DEA
  const used   = formations.reduce((n, f) => n + seatsUsedBy(f), 0)
  const done   = formations.filter(f => f.status === 'fait').length
  return {
    seatsPerDea: SEATS_PER_DEA,
    deaCount,
    credit,
    used,
    remaining: credit - used,
    formationsTotal: formations.length,
    formationsDone:  done,
  }
}

module.exports = { SEATS_PER_DEA, trainingQuota, seatsUsedBy }
