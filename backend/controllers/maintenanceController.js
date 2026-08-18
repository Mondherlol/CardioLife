const { TASKS } = require('../utils/maintenance')

/**
 * Reprises de données lancées depuis l'application.
 *
 * Les mêmes opérations que les scripts du serveur, pour ne pas dépendre d'un
 * accès SSH quand une fiche affiche une date fausse un dimanche soir. Elles
 * partagent l'implémentation des scripts : ce qui tourne ici est exactement ce
 * qui tourne en ligne de commande.
 *
 * Réservé au super admin — ces reprises réécrivent des données métier. Et
 * chacune sait d'abord se contenter de regarder : `dry` est le mode par défaut,
 * l'écriture se demande explicitement.
 */

function list(req, res) {
  res.json(Object.entries(TASKS).map(([id, t]) => ({
    id,
    label:       t.label,
    description: t.description,
    detail:      t.detail,
    options:     t.options || [],
  })))
}

async function run(req, res) {
  const task = TASKS[req.params.task]
  if (!task) return res.status(404).json({ message: 'Reprise inconnue.' })

  /* On n'écrit que si on le demande : un appel sans `dry: false` explicite se
     contente de simuler. Le défaut protège du clic malheureux. */
  const dry = req.body?.dry !== false

  const options = {}
  for (const opt of task.options || []) {
    options[opt.id] = req.body?.[opt.id] === true
  }

  try {
    const started = Date.now()
    const report  = await task.run({ ...options, dry, userId: req.user._id })
    res.json({ ...report, label: task.label, durationMs: Date.now() - started })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

module.exports = { list, run }
