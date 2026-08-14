const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')

/**
 * Calendrier des contrôles d'un site sous contrat.
 *
 * Le rythme suit l'appareil, pas la paperasse : les visites tombent tous les
 * six mois à compter de la **pose**, et non de la signature du contrat. La
 * première visite est semestrielle, la deuxième — à l'anniversaire de la pose —
 * est le contrôle annuel, et ainsi de suite en alternance.
 *
 * Le contrat ne fait que borner la période couverte.
 */

const PERIOD_MONTHS = 6
/* Un contrat signé longtemps après la pose ne recrée pas tout l'historique :
   on ne remonte pas au-delà d'un an avant son début. */
const BACKFILL_YEARS = 1
const MAX_OCCURRENCES = 60

/** Ajoute des mois en restant dans le mois cible (31 août + 6 → 28/29 févr.). */
function addMonths(date, n) {
  const d = new Date(date)
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() !== day) d.setDate(0)
  return d
}

/**
 * Reporte une échéance tombant un week-end au lundi suivant : personne ne se
 * déplace chez un client le samedi ou le dimanche. Samedi + 2, dimanche + 1.
 */
function skipWeekend(date) {
  const d = new Date(date)
  const day = d.getDay()            // 0 = dimanche, 6 = samedi
  if (day === 6) d.setDate(d.getDate() + 2)
  else if (day === 0) d.setDate(d.getDate() + 1)
  return d
}

/** Point de départ : la première pose du site, à défaut le début du contrat. */
function scheduleAnchor(site, contract) {
  const poses = (site?.deas || [])
    .map(d => d.installationDate)
    .filter(Boolean)
    .map(d => new Date(d).getTime())
  if (poses.length) return new Date(Math.min(...poses))
  return contract?.startDate ? new Date(contract.startDate) : null
}

/** Échéances théoriques du contrat : [{ date, type }]. */
function scheduleFor(site, contract) {
  const anchor = scheduleAnchor(site, contract)
  if (!anchor || !contract?.endDate) return []

  const end   = new Date(contract.endDate)
  const floor = new Date(contract.startDate || anchor)
  floor.setFullYear(floor.getFullYear() - BACKFILL_YEARS)

  const out = []
  for (let i = 1; i <= MAX_OCCURRENCES; i++) {
    // Le rythme reste ancré sur la pose : le report du week-end s'applique à la
    // visite, pas au calcul, sinon chaque décalage se propagerait au suivant.
    const date = skipWeekend(addMonths(anchor, i * PERIOD_MONTHS))
    date.setHours(9, 0, 0, 0)              // heure par défaut des visites générées
    if (date > end) break
    if (date < floor) continue
    // Une visite sur deux, à l'anniversaire de la pose, est le contrôle annuel.
    out.push({ date, type: i % 2 === 0 ? 'annuel' : 'semestriel' })
  }
  return out
}

const dayKey = d => new Date(d).toISOString().slice(0, 10)

/**
 * Aligne les contrôles enregistrés sur le calendrier théorique.
 *
 * Les visites déjà réalisées ne sont jamais touchées. Les visites planifiées
 * qui ne correspondent plus à une échéance (période ou date de pose modifiée)
 * sont retirées, les échéances manquantes sont créées.
 */
async function syncContractControls(contract, userId) {
  if (!contract?.site) return { created: 0, removed: 0 }

  const site = await Site.findById(contract.site).select('name deas')
  const planned = scheduleFor(site, contract)
  const plannedKeys = new Set(planned.map(p => dayKey(p.date)))

  const existing = await Intervention.find({ contract: contract._id })
    .select('scheduledDate status controlType')
    .lean()

  const keptKeys = new Set()
  const obsolete = []
  for (const iv of existing) {
    const key = iv.scheduledDate ? dayKey(iv.scheduledDate) : null
    // Une visite faite reste, même hors calendrier : elle a eu lieu.
    if (iv.status === 'termine') { if (key) keptKeys.add(key); continue }
    if (key && plannedKeys.has(key)) { keptKeys.add(key); continue }
    obsolete.push(iv._id)
  }

  if (obsolete.length) await Intervention.deleteMany({ _id: { $in: obsolete } })

  const docs = planned
    .filter(p => !keptKeys.has(dayKey(p.date)))
    .map(p => ({
      client:        contract.client || undefined,
      clientName:    contract.clientName || undefined,
      site:          contract.site,
      siteName:      contract.siteName || site?.name,
      contract:      contract._id,
      controlType:   p.type,
      scheduledDate: p.date,
      status:        'planifie',
      history: [{
        action: 'creation', user: userId,
        details: `Contrôle ${p.type} planifié par le contrat (six mois après la pose)`,
      }],
      createdBy:     userId,
    }))

  if (docs.length) await Intervention.insertMany(docs)

  await syncSiteNextControl(contract.site)
  return { created: docs.length, removed: obsolete.length }
}

/**
 * Reporte sur chaque DAE du site la date de sa prochaine visite. Une visite
 * couvre le site entier : tous ses appareils partagent donc la même échéance.
 */
async function syncSiteNextControl(siteId) {
  if (!siteId) return null

  const next = await Intervention.findOne({
    site: siteId,
    status: { $ne: 'termine' },
    scheduledDate: { $ne: null },
  })
    .sort({ scheduledDate: 1 })
    .select('scheduledDate')
    .lean()

  const site = await Site.findById(siteId)
  if (!site) return null

  site.deas.forEach(dea => { dea.nextControlDate = next?.scheduledDate || undefined })
  await site.save()
  return next?.scheduledDate || null
}

/** Réaligne le calendrier du site après une modification de son parc. */
async function syncSiteControls(siteId, userId) {
  if (!siteId) return
  // Chargement tardif : le modèle Contract dépend lui aussi de ce module.
  const Contract = require('../models/Contract')
  const contract = await Contract.findOne({ site: siteId, isActive: true, status: 'actif' })
  if (contract) await syncContractControls(contract, userId)
  else await syncSiteNextControl(siteId)
}

module.exports = {
  PERIOD_MONTHS, addMonths, skipWeekend, scheduleAnchor, scheduleFor,
  syncContractControls, syncSiteNextControl, syncSiteControls,
}
