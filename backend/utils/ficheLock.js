/**
 * Une écriture à la fois par visite.
 *
 * Chaque enregistrement de la checklist lit l'intervention, la modifie, puis la
 * réécrit. Deux enregistrements simultanés — deux champs saisis coup sur coup —
 * lisaient la même version : pour un appareil sans fiche, chacun en créait une,
 * et la visite se retrouvait avec deux fiches pour le même DAE (l'une recevant
 * les saisies, l'autre affichée à l'écran). On les fait donc passer l'un après
 * l'autre, par visite. Le serveur tourne en un seul processus : une file en
 * mémoire suffit.
 */
const queues = new Map()

function withInterventionLock(id, fn) {
  const key  = String(id)
  const prev = queues.get(key) || Promise.resolve()
  const run  = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  queues.set(key, tail)
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return run
}

/** Enveloppe un contrôleur Express : il s'exécute dans la file de sa visite. */
const lockedById = handler => (req, res) => withInterventionLock(req.params.id, () => handler(req, res))

/**
 * Fusionne les fiches en double d'un même appareil (laissées par d'anciens
 * enregistrements simultanés). La première fiche — celle qui recevait les
 * saisies — l'emporte ; les champs qu'elle n'a pas sont repris des autres, et
 * les photos s'additionnent. Renvoie `true` si quelque chose a changé.
 */
function mergeDuplicateFiches(intervention) {
  const fiches = intervention.fiches || []
  if (fiches.length < 2) return false
  const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)
  const keep = []
  const byKey = new Map()
  let changed = false

  for (const f of fiches) {
    const key = String(f.dea || '')
    const base = byKey.get(key)
    if (!base) { byKey.set(key, f); keep.push(f); continue }
    changed = true
    const other = f.toObject ? f.toObject() : f
    for (const [field, value] of Object.entries(other)) {
      if (field === '_id' || field === 'dea') continue
      if (field === 'photos') {
        base.photos = [...new Set([...(base.photos || []), ...(value || [])])]
        continue
      }
      if (empty(base[field]) && !empty(value)) base[field] = value
    }
  }
  if (changed) {
    intervention.fiches = keep
    intervention.markModified('fiches')
  }
  return changed
}

module.exports = { withInterventionLock, lockedById, mergeDuplicateFiches }
