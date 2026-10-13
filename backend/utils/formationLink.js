const Intervention = require('../models/Intervention')
const Formation    = require('../models/Formation')

/**
 * Lien entre une visite (contrôle, intervention) et la formation des agents
 * qui l'accompagne.
 *
 * Il vit des deux côtés — `Intervention.formation.formation` et
 * `Formation.intervention` — pour que la fiche du contrôle trouve sa séance et
 * que la séance sache de quelle visite elle relève. Une formation n'accompagne
 * qu'une visite : la lier ailleurs la détache de la précédente.
 */

const DEFAULT_TITLE = "Formation à l'utilisation du défibrillateur"

function who(user) {
  return { user: user?._id, userName: user?.fullName || user?.username }
}

/** Retire le lien côté visite (sans toucher à l'état « effectuée / reportée »). */
async function detachFromIntervention(interventionId, formation, user, reason) {
  const iv = await Intervention.findById(interventionId)
  if (!iv || String(iv.formation?.formation || '') !== String(formation._id)) return
  iv.formation.formation = undefined
  iv.formation.titre = ''
  iv.markModified('formation')
  iv.history.push({ ...who(user), action: 'formation', details: reason || `Formation déliée — ${formation.title}` })
  await iv.save()
}

async function linkFormation(intervention, formation, user) {
  // Ancienne séance de cette visite : elle redevient indépendante.
  const previous = intervention.formation?.formation
  if (previous && String(previous) !== String(formation._id)) {
    await Formation.updateOne({ _id: previous, intervention: intervention._id }, { $unset: { intervention: 1 } })
  }
  // Séance déjà liée à une autre visite : elle la quitte.
  if (formation.intervention && String(formation.intervention) !== String(intervention._id)) {
    await detachFromIntervention(formation.intervention, formation, user,
      `Formation déplacée vers une autre visite — ${formation.title}`)
  }

  formation.intervention = intervention._id
  formation.history.push({
    action: 'Liée à une visite', by: user?._id, at: new Date(),
    details: `Visite du ${new Date(intervention.scheduledDate).toLocaleDateString('fr-FR')}`,
  })
  await formation.save()

  if (!intervention.formation) intervention.formation = {}
  intervention.formation.formation = formation._id
  intervention.formation.titre     = formation.title
  intervention.markModified('formation')
  intervention.history.push({ ...who(user), action: 'formation', details: `Formation liée — ${formation.title}` })
  await intervention.save()
}

async function unlinkFormation(intervention, user) {
  const id = intervention.formation?.formation
  if (!id) return
  const formation = await Formation.findById(id)
  if (formation && String(formation.intervention || '') === String(intervention._id)) {
    formation.intervention = undefined
    formation.history.push({ action: 'Déliée de la visite', by: user?._id, at: new Date() })
    await formation.save()
  }
  intervention.formation.formation = undefined
  intervention.formation.titre = ''
  intervention.markModified('formation')
  intervention.history.push({ ...who(user), action: 'formation', details: `Formation déliée${formation ? ` — ${formation.title}` : ''}` })
  await intervention.save()
}

/** Nouvelle séance, le même jour que la visite, puis liée à elle. */
async function createLinkedFormation(intervention, { title, participantsCount, durationMin = 120 } = {}, user) {
  const start = new Date(intervention.scheduledDate || Date.now())
  const formation = await Formation.create({
    client:     intervention.client?._id || intervention.client,
    clientName: intervention.clientName,
    site:       intervention.site?._id || intervention.site || undefined,
    siteName:   intervention.siteName || intervention.site?.name || undefined,
    title:      String(title || '').trim() || DEFAULT_TITLE,
    date:       start,
    end:        new Date(start.getTime() + durationMin * 60000),
    participantsCount: Math.max(0, Number(participantsCount) || 0),
    assignedTo: intervention.technicien ? [intervention.technicien._id || intervention.technicien] : [],
    status:     'planifie',
    createdBy:  user?._id,
    history: [{
      action: 'Formation créée', by: user?._id, at: new Date(),
      details: 'Programmée avec la visite de contrôle',
    }],
  })
  await linkFormation(intervention, formation, user)
  return formation
}

/**
 * La visite change de jour : sa séance du même jour la suit, à la même heure
 * relative. Une séance déjà tenue, annulée, ou fixée un autre jour ne bouge pas.
 */
async function followVisitDate(intervention, oldDate, user) {
  const id = intervention.formation?.formation
  if (!id || !oldDate || !intervention.scheduledDate) return
  const formation = await Formation.findById(id)
  if (!formation || !['planifie', 'en_cours'].includes(formation.status)) return
  const sameDay = new Date(formation.date).toDateString() === new Date(oldDate).toDateString()
  if (!sameDay) return
  const delta = new Date(intervention.scheduledDate) - new Date(oldDate)
  if (!delta) return
  formation.date = new Date(new Date(formation.date).getTime() + delta)
  if (formation.end) formation.end = new Date(new Date(formation.end).getTime() + delta)
  formation.history.push({
    action: 'Déplacée avec la visite', by: user?._id, at: new Date(),
    details: `Nouvelle date : ${formation.date.toLocaleDateString('fr-FR')}`,
  })
  await formation.save()
}

module.exports = { linkFormation, unlinkFormation, createLinkedFormation, followVisitDate, DEFAULT_TITLE }
