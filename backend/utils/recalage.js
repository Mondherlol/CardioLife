const Intervention = require('../models/Intervention')
const Site         = require('../models/Site')
const { syncSiteNextControl } = require('./controls')

/**
 * Recalage du calendrier des contrôles périodiques, site par site.
 *
 * L'import du parc a parfois deviné les types de travers : sans date de pose
 * ni type dans le fichier, le dernier contrôle était noté « semestriel » et le
 * suivant… aussi. Deux semestriels d'affilée, puis l'équipe calait « l'annuel »
 * de six mois plus tard à la place, et le site se retrouvait avec deux visites
 * dues en octobre et rien en avril. Ailleurs, une visite déjà en retard au
 * moment de l'import n'avait pas été créée du tout.
 *
 * La règle : à partir du dernier contrôle réalisé, une visite tous les six
 * mois, en alternance — après un semestriel vient l'annuel, et inversement.
 *
 *  - Les contrôles **déjà calés** par l'équipe (technicien assigné, date
 *    déplacée à la main, visite commencée) gardent leur date et prennent le
 *    type de l'échéance la plus proche.
 *  - Les **échéances théoriques** (celles de l'import, sans technicien) se
 *    rangent sur les créneaux restants : date et type.
 *  - Un créneau resté vide entre deux visites est une **visite manquante** :
 *    elle est recréée (en retard si sa date est passée).
 *
 * Rien ne s'écrit en simulation ; à l'exécution, seuls les sites cochés sont
 * modifiés, et chaque changement s'inscrit dans l'historique du contrôle.
 */

const PERIODIC = ['semestriel', 'annuel']
const LABEL    = { semestriel: 'Semestriel', annuel: 'Annuel' }
const DAY      = 86400000
// Un contrôle calé à plus de quatre mois de toute échéance n'est rattaché à aucune.
const FIRM_WINDOW = 122 * DAY
/* Une échéance à six semaines près de son créneau est à sa place : report du
   week-end, jour précis donné par le fichier ou par une checklist. On n'y
   touche pas — seul son type peut changer. */
const SAME_SLOT = 45 * DAY

/** Samedi et dimanche reportés au lundi : personne ne se déplace le week-end. */
function skipWeekend(date) {
  const d = new Date(date)
  const day = d.getDay()
  if (day === 6) d.setDate(d.getDate() + 2)
  else if (day === 0) d.setDate(d.getDate() + 1)
  return d
}

function addMonths(date, n) {
  const d = new Date(date)
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() !== day) d.setDate(0)
  return d
}
const dayKey   = d => new Date(d).toISOString().slice(0, 10)
const fmt      = d => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })
const opposite = t => (t === 'semestriel' ? 'annuel' : 'semestriel')
const dateOf   = c => new Date(c.completedDate || c.scheduledDate)

/** Contrôle calé par l'équipe : on respecte sa date. */
function isFirm(c) {
  if (c.status === 'en_cours' || c.technicien) return true
  return (c.history || []).some(h =>
    h.action === 'replanification' || /Date planifiée|Date fixée|reporté/i.test(h.details || ''))
}

/** Même heure de passage que le contrôle d'origine, au jour du créneau. */
function onDay(slotDate, timeFrom) {
  const d = new Date(slotDate)
  const t = new Date(timeFrom)
  d.setHours(t.getHours(), t.getMinutes(), 0, 0)
  return d
}

/** Changements à apporter aux contrôles d'un site (calcul pur, rien n'est écrit). */
function planSite(controls, today = new Date()) {
  const periodic = controls.filter(c => PERIODIC.includes(c.controlType) && c.scheduledDate)
  const last = periodic
    .filter(c => c.status === 'termine')
    .sort((a, b) => dateOf(b) - dateOf(a))[0]
  if (!last) return null

  const pending = periodic
    .filter(c => c.status !== 'termine')
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
  if (!pending.length) return null

  // Échéances attendues après le dernier contrôle, jusqu'au-delà du dernier prévu.
  const limit = addMonths(new Date(Math.max(new Date(pending.at(-1).scheduledDate), today)), 3)
  const slots = []
  for (let k = 1; k <= 40; k++) {
    const date = addMonths(dateOf(last), 6 * k)
    if (date > limit) break
    slots.push({ date, type: k % 2 ? opposite(last.controlType) : last.controlType, taken: null })
  }

  const nearestFree = (c, window) => {
    const t = new Date(c.scheduledDate).getTime()
    let best = null
    for (const s of slots) {
      if (s.taken) continue
      const dist = Math.abs(s.date - t)
      if (dist > window) continue
      if (!best || dist < Math.abs(best.date - t)) best = s
    }
    return best
  }

  const changes = []
  const label   = c => `${LABEL[c.controlType]} du ${fmt(c.scheduledDate)}`

  // 1. Ce que l'équipe a calé : la date reste, le type suit l'échéance.
  const firm = pending.filter(isFirm)
  const theo = pending.filter(c => !isFirm(c))
  for (const c of firm) {
    const s = nearestFree(c, FIRM_WINDOW)
    if (!s) { changes.push({ action: 'unmatched', id: c._id, label: label(c), firm: true }); continue }
    s.taken = c
    if (s.type !== c.controlType) {
      changes.push({
        action: 'retype', id: c._id, label: label(c), firm: true,
        fromType: c.controlType, toType: s.type, fromDate: c.scheduledDate, toDate: c.scheduledDate,
      })
    }
  }

  // 2. Les échéances théoriques prennent les créneaux restants, les plus proches.
  for (const c of theo) {
    const s = nearestFree(c, 400 * DAY)
    if (!s) { changes.push({ action: 'unmatched', id: c._id, label: label(c), firm: false }); continue }
    s.taken = c
    const close  = Math.abs(s.date - new Date(c.scheduledDate)) <= SAME_SLOT
    const toDate = close ? new Date(c.scheduledDate) : skipWeekend(onDay(s.date, c.scheduledDate))
    const moved  = dayKey(toDate) !== dayKey(c.scheduledDate)
    if (moved || s.type !== c.controlType) {
      changes.push({
        action: moved ? 'move' : 'retype', id: c._id, label: label(c), firm: false,
        fromType: c.controlType, toType: s.type, fromDate: c.scheduledDate, toDate,
      })
    }
  }

  /* 3. Un créneau vide avant la dernière visite rattachée : visite manquante.
     Dans le passé, une seule — la plus récente : un site sans visite depuis
     deux ans a besoin d'un rattrapage, pas de quatre contrôles en retard. */
  const lastTaken = Math.max(...slots.filter(s => s.taken).map(s => s.date.getTime()), 0)
  const holes = slots.filter(s => !s.taken && s.date.getTime() <= lastTaken)
  const pastHoles = holes.filter(s => s.date < today)
  const keep = [...(pastHoles.length ? [pastHoles.at(-1)] : []), ...holes.filter(s => s.date >= today)]
  for (const s of keep) {
    changes.push({
      action: 'create', toType: s.type, toDate: skipWeekend(onDay(s.date, last.scheduledDate)),
      late: s.date < today,
      skipped: s.date < today ? pastHoles.length - 1 : 0,
    })
  }

  return {
    last: { type: last.controlType, date: dateOf(last) },
    changes,
  }
}

async function recalerControles({ dry = true, selection, userId = null } = {}) {
  const controls = await Intervention.find({ controlType: { $in: PERIODIC }, site: { $ne: null } })
    .select('site siteName client clientName contract controlType status scheduledDate completedDate technicien history enAttente')
    .lean()

  const bySite = {}
  for (const c of controls) (bySite[String(c.site)] ||= []).push(c)

  const siteDocs = await Site.find({ _id: { $in: Object.keys(bySite) } }).select('name clientName client').populate('client', 'name').lean()
  const siteInfo = Object.fromEntries(siteDocs.map(s => [String(s._id), s]))

  const wanted = Array.isArray(selection) ? new Set(selection.map(String)) : null
  const report = { task: 'recaler-controles', dry, sites: [], totals: { sites: 0, retype: 0, move: 0, create: 0, applied: 0 } }

  for (const [siteId, list] of Object.entries(bySite)) {
    const plan = planSite(list)
    if (!plan) continue
    const actionable = plan.changes.filter(c => c.action !== 'unmatched')
    if (!plan.changes.length) continue

    const info = siteInfo[siteId] || {}
    const entry = {
      siteId,
      site:   info.name || list[0].siteName,
      client: info.client?.name || info.clientName || list[0].clientName,
      last:   plan.last,
      changes: plan.changes,
      applied: false,
    }
    report.sites.push(entry)
    report.totals.sites++
    for (const c of actionable) report.totals[c.action]++

    if (dry || (wanted && !wanted.has(siteId)) || !actionable.length) continue

    const ref = list.find(c => c.contract) || list[0]
    for (const c of actionable) {
      if (c.action === 'create') {
        await Intervention.create({
          client: ref.client, clientName: ref.clientName,
          site: ref.site, siteName: ref.siteName,
          contract: ref.contract || undefined,
          controlType: c.toType, scheduledDate: c.toDate, manualDate: true, status: 'planifie',
          createdBy: userId || undefined,
          history: [{
            action: 'creation', user: userId || undefined, userName: 'Recalage du calendrier',
            details: `${LABEL[c.toType]} recréé : visite manquante dans le calendrier du site`,
          }],
        })
        continue
      }
      const doc = await Intervention.findById(c.id)
      if (!doc || doc.status === 'termine') continue
      const parts = []
      if (doc.controlType !== c.toType) parts.push(`Type : ${LABEL[doc.controlType]} → ${LABEL[c.toType]}`)
      if (dayKey(doc.scheduledDate) !== dayKey(c.toDate)) parts.push(`Date planifiée : ${fmt(doc.scheduledDate)} → ${fmt(c.toDate)}`)
      doc.controlType   = c.toType
      doc.scheduledDate = c.toDate
      doc.manualDate    = true
      doc.history.push({
        action: 'recalage', user: userId || undefined, userName: 'Recalage du calendrier',
        details: `Calendrier recalé (alternance semestriel / annuel) — ${parts.join(' · ')}`,
      })
      await doc.save()
    }
    await syncSiteNextControl(siteId)
    entry.applied = true
    report.totals.applied++
  }

  report.sites.sort((a, b) => String(a.client).localeCompare(String(b.client), 'fr') || String(a.site).localeCompare(String(b.site), 'fr'))
  return report
}

module.exports = { recalerControles, planSite }
