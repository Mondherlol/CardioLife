const Site         = require('../models/Site')
const Intervention = require('../models/Intervention')
const { skipWeekend, syncSiteNextControl } = require('./controls')

/**
 * Remontée de la checklist vers le parc et le planning.
 *
 * Le parc (`Site.deas`) et la checklist d'une visite décrivaient jusqu'ici le
 * même appareil sans jamais se parler : le technicien relevait une péremption
 * de batterie sur place, la fiche client continuait d'afficher celle saisie à
 * la pose. Le commercial qui appelle un client pour un remplacement se fiait
 * donc à une donnée périmée.
 *
 * Ce module rejoue, au moment de la clôture, la visite sur le parc : ce qui a
 * été constaté devient l'état officiel du DAE. Le sens est unique et voulu tel
 * quel — le terrain fait foi, la fiche client suit.
 *
 * Règle de prudence : un champ laissé vide dans la checklist n'efface jamais
 * la valeur du parc. Un point non renseigné n'est pas un constat de vide.
 */

const filled = v => v !== undefined && v !== null && v !== ''

function sameDay(a, b) {
  if (!a || !b) return false
  const da = new Date(a), db = new Date(b)
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return false
  return da.toDateString() === db.toDateString()
}

const fmtDate = d => (d ? new Date(d).toLocaleDateString('fr-FR') : 'vide')

/**
 * Ligne de batterie visée par la fiche.
 *
 * Le parc en accepte plusieurs (appareil à double baie), la checklist n'en
 * relève qu'une : la première, celle qui est en place.
 */
function batteryLine(dea) {
  if (!dea.batteries?.length) dea.batteries.push({})
  return dea.batteries[0]
}

/**
 * Ligne d'électrodes correspondant au jeu contrôlé.
 *
 * Le parc distingue « adulte » et « enfant ». Une ligne sans genre — parc
 * repris, import — est adoptée par le jeu adulte plutôt que dupliquée.
 */
function electrodeLine(dea, kind) {
  let line = dea.electrodes?.find(e => e.kind === kind)
  if (!line && kind === 'adulte') line = dea.electrodes?.find(e => !e.kind)
  if (!line) {
    dea.electrodes.push({ kind })
    line = dea.electrodes[dea.electrodes.length - 1]
  }
  return line
}

/** Écrit `value` dans `target[field]` et décrit le changement, s'il y en a un. */
function apply(target, field, value, label, changes, { date = false } = {}) {
  if (!filled(value)) return
  const before = target[field]
  const same = date ? sameDay(before, value) : String(before ?? '') === String(value)
  if (same) return
  target[field] = value
  changes.push(date
    ? `${label} : ${fmtDate(before)} → ${fmtDate(value)}`
    : `${label} : ${before || 'vide'} → ${value}`)
}

/** Reporte une fiche d'appareil sur le DAE correspondant du parc. */
function applyFicheToDea(fiche, dea, changes) {
  const name = dea.deviceType || dea.serialNumber || 'DAE'
  const local = []

  apply(dea, 'serialNumber', fiche.serialNumber, 'N° de série', local)
  apply(dea, 'location',     fiche.emplacement,  'Emplacement', local)

  if (filled(fiche.batteriePeremption) || filled(fiche.batteriePct)
      || (fiche.batterieRemplacee && filled(fiche.batterieRemplaceeRef))) {
    const batt = batteryLine(dea)
    apply(batt, 'expiryDate', fiche.batteriePeremption, 'Péremption batterie', local, { date: true })
    apply(batt, 'level',      fiche.batteriePct,        'Niveau batterie',     local)
    // Une pièce posée remplace celle qui était en place : c'est son numéro qui
    // doit figurer au parc, sinon le suivi porte sur une batterie déposée.
    // Série ou lot : on écrit dans le champ que cette ligne utilise déjà.
    if (fiche.batterieRemplacee) {
      const numField = batt.lotNumber && !batt.serialNumber ? 'lotNumber' : 'serialNumber'
      const numLabel = numField === 'lotNumber' ? 'Lot batterie posée' : 'N° batterie posée'
      apply(batt, numField, fiche.batterieRemplaceeRef, numLabel, local)
    }
  }

  if (filled(fiche.electrodesPeremptionAdulte)
      || (fiche.electrodesRemplacees && filled(fiche.electrodesRemplaceesRef))) {
    const adulte = electrodeLine(dea, 'adulte')
    apply(adulte, 'expiryDate', fiche.electrodesPeremptionAdulte,
      'Péremption électrodes adulte', local, { date: true })
    if (fiche.electrodesRemplacees) {
      apply(adulte, 'lotNumber', fiche.electrodesRemplaceesRef, 'Lot électrodes posées', local)
    }
  }

  if (filled(fiche.electrodesPeremptionPediatrique)) {
    const enfant = electrodeLine(dea, 'enfant')
    apply(enfant, 'expiryDate', fiche.electrodesPeremptionPediatrique,
      'Péremption électrodes pédiatriques', local, { date: true })
  }

  local.forEach(c => changes.push(`${name} — ${c}`))
}

/**
 * DAE du parc que cette fiche décrit.
 *
 * Une fiche sans appareil — visite d'avant le multi-DAE, site à un seul DAE —
 * vise le DAE de l'intervention, ou l'unique du site quand il ne laisse place
 * à aucune ambiguïté.
 */
function resolveDea(site, intervention, fiche) {
  if (fiche.dea) return site.deas.id(fiche.dea)
  if (intervention.installation) return site.deas.id(intervention.installation)
  return site.deas.length === 1 ? site.deas[0] : null
}

/**
 * Date du prochain passage décidée sur place.
 *
 * Une visite couvre le site entier : si plusieurs fiches en portent une, la
 * plus proche l'emporte — c'est elle qui rappelle le technicien en premier.
 */
function nextControlFromFiches(fiches) {
  const times = (fiches || [])
    .map(f => f.prochainControle)
    .filter(Boolean)
    .map(d => new Date(d).getTime())
    .filter(t => !isNaN(t))
  return times.length ? new Date(Math.min(...times)) : null
}

/**
 * Porte cette date dans le planning.
 *
 * On déplace la prochaine visite ouverte du site plutôt que d'en créer une :
 * le technicien fixe la date d'un contrôle qui figure déjà au calendrier du
 * contrat. La visite est marquée `manualDate` pour que la règle des six mois
 * ne la ramène pas à sa date théorique — le terrain sait où en est le parc.
 */
async function applyNextControl(intervention, date, user, changes, dry) {
  const shifted = skipWeekend(new Date(date))
  shifted.setHours(9, 0, 0, 0)

  const next = await Intervention.findOne({
    site:   intervention.site,
    status: { $ne: 'termine' },
    _id:    { $ne: intervention._id },
  }).sort({ scheduledDate: 1 })

  if (next) {
    if (sameDay(next.scheduledDate, shifted)) return
    const before = next.scheduledDate
    if (dry) { changes.push(`Prochaine visite à déplacer au ${fmtDate(shifted)}`); return }
    next.scheduledDate = shifted
    next.manualDate    = true
    next.history.push({
      action:   'modification',
      user:     user?._id,
      userName: user?.fullName || user?.username,
      details:  `Date fixée par la checklist de la visite précédente : ${fmtDate(before)} → ${fmtDate(shifted)}`,
    })
    await next.save()
    changes.push(`Prochaine visite déplacée au ${fmtDate(shifted)}`)
    return
  }

  // Aucune visite ouverte : hors contrat, ou fin de calendrier. La date
  // relevée sur place ne doit pas se perdre pour autant.
  if (dry) { changes.push(`Prochaine visite à créer au ${fmtDate(shifted)}`); return }
  await Intervention.create({
    client:        intervention.client,
    clientName:    intervention.clientName,
    site:          intervention.site,
    siteName:      intervention.siteName,
    installation:  intervention.installation,
    installationSnap: intervention.installationSnap,
    contract:      intervention.contract,
    controlType:   intervention.controlType || 'hors_contrat',
    scheduledDate: shifted,
    manualDate:    true,
    status:        'planifie',
    createdBy:     user?._id,
    history: [{
      action:   'creation',
      user:     user?._id,
      userName: user?.fullName || user?.username,
      details:  'Visite planifiée depuis la checklist de la visite précédente',
    }],
  })
  changes.push(`Prochaine visite créée au ${fmtDate(shifted)}`)
}

/**
 * Rejoue la visite sur le parc du site et sur le planning.
 *
 * `dry` regarde sans écrire — c'est ce que la reprise propose avant de valider.
 * `planning` se coupe pour un rattrapage d'anciennes visites : rejouer la date
 * de prochain passage d'une visite de 2024 ramènerait le planning d'aujourd'hui
 * à une échéance déjà dépassée.
 *
 * Ne lève jamais : une remontée qui échoue ne doit pas faire perdre une visite
 * déjà enregistrée. Retourne la liste des changements, pour l'historique.
 */
async function syncFicheToParc(intervention, user, { dry = false, planning = true } = {}) {
  const changes = []
  try {
    let siteId = intervention.site
    if (!siteId && intervention.installation) {
      const owner = await Site.findOne({ 'deas._id': intervention.installation }).select('_id').lean()
      siteId = owner?._id
    }
    if (!siteId) return changes

    const site = await Site.findById(siteId)
    if (!site) return changes

    for (const fiche of intervention.fiches || []) {
      const dea = resolveDea(site, intervention, fiche)
      if (!dea) continue
      applyFicheToDea(fiche, dea, changes)
    }

    if (changes.length && !dry) await site.save()

    const next = planning ? nextControlFromFiches(intervention.fiches) : null
    if (next && intervention.site) await applyNextControl(intervention, next, user, changes, dry)

    // La date affichée sur les DAE suit la visite qui vient d'être replanifiée.
    if (!dry) await syncSiteNextControl(siteId)
  } catch (err) {
    console.error('Remontée de la checklist vers le parc échouée :', err.message)
  }
  return changes
}

module.exports = { syncFicheToParc, applyFicheToDea, resolveDea, nextControlFromFiches }
