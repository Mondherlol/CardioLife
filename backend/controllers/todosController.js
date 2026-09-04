const path = require('path')
const fs   = require('fs')
const Todo = require('../models/Todo')

const STATUSES = ['todo', 'doing', 'done']

/* Champs que le client a le droit de poser lui-même. Une liste explicite
   évite qu'un `req.body` bavard n'écrase `createdBy` ou les horodatages. */
const WRITABLE = [
  'title', 'notes', 'status', 'category', 'requestedAt', 'position',
  'response', 'validation', 'feedback',
]

const VALIDATIONS = ['pending', 'ok', 'ko']

/**
 * Nettoyage du HTML collé dans « Réponse » et « Retours ».
 *
 * La page est réservée aux administrateurs, mais du contenu collé depuis un
 * mail ou un site embarque du script et des attributs d'événement. On garde le
 * strict nécessaire : mise en forme légère, liens, images, listes.
 */
const BALISES_OK = new Set([
  'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'a', 'img', 'code', 'pre',
])

function sanitizeHtml(html) {
  if (typeof html !== 'string') return ''
  return html
    // Contenus exécutables : supprimés avec leur contenu, pas seulement la balise.
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (tag, nom, attrs) => {
      if (!BALISES_OK.has(nom.toLowerCase())) return ''
      if (tag.startsWith('</')) return `</${nom.toLowerCase()}>`
      // Seuls href, src, alt et title survivent — exit les `on*` et les styles.
      const gardes = []
      const re = /([a-z-]+)\s*=\s*"([^"]*)"|([a-z-]+)\s*=\s*'([^']*)'/gi
      let m
      while ((m = re.exec(attrs))) {
        const cle = (m[1] || m[3] || '').toLowerCase()
        const val = m[2] ?? m[4] ?? ''
        if (!['href', 'src', 'alt', 'title'].includes(cle)) continue
        // `javascript:` et `data:` dans un href ouvrent une exécution.
        if (['href', 'src'].includes(cle) && /^\s*(javascript|vbscript|data)\s*:/i.test(val)) continue
        gardes.push(`${cle}="${val.replace(/"/g, '&quot;')}"`)
      }
      const nomBas = nom.toLowerCase()
      // Un lien collé doit s'ouvrir à côté, pas remplacer l'application.
      if (nomBas === 'a') gardes.push('target="_blank"', 'rel="noreferrer noopener"')
      return `<${nomBas}${gardes.length ? ' ' + gardes.join(' ') : ''}>`
    })
}

function pick(body) {
  const out = {}
  for (const k of WRITABLE) if (body[k] !== undefined) out[k] = body[k]
  // Les deux colonnes libres acceptent du HTML : il ne rentre que nettoyé.
  if (out.response !== undefined) out.response = sanitizeHtml(out.response)
  if (out.feedback !== undefined) out.feedback = sanitizeHtml(out.feedback)
  return out
}

/* `completedAt` suit le statut sans que l'appelant ait à y penser : c'est la
   date qui répond à « depuis quand est-ce fait ? ». */
function syncCompletion(doc, nextStatus) {
  if (nextStatus === 'done' && doc.status !== 'done') doc.completedAt = new Date()
  if (nextStatus !== 'done') doc.completedAt = undefined
}

/* Même principe pour la validation : la date de la prise de position se pose
   toute seule, et disparaît si l'équipe revient à « en attente ». */
function syncValidation(doc, next) {
  if (next !== doc.validation) doc.validatedAt = next === 'pending' ? undefined : new Date()
}

async function getAll(req, res) {
  try {
    const { status, category, q } = req.query
    const query = {}
    if (status && STATUSES.includes(status)) query.status = status
    if (category) query.category = category
    if (q) {
      // Échappe les métacaractères : une recherche « c++ » ne doit pas faire
      // exploser le moteur d'expressions régulières.
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      query.$or = [{ title: rx }, { notes: rx }, { category: rx }, { response: rx }, { feedback: rx }]
    }

    const todos = await Todo.find(query)
      /* Les demandes les plus récentes en tête : c'est ce qu'on vient
         regarder. `createdAt` départage deux lignes du même jour. */
      .sort({ requestedAt: -1, createdAt: -1 })
      .populate('createdBy', 'fullName username')
      .populate('updatedBy', 'fullName username')
      .lean()

    res.json(todos)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function create(req, res) {
  try {
    const data = pick(req.body)
    if (!String(data.title || '').trim()) {
      return res.status(400).json({ message: 'Le titre est requis.' })
    }
    /* Nouvelle tâche en tête de liste : on la saisit parce qu'elle vient
       d'arriver, pas pour l'enterrer sous cinquante lignes. */
    const first = await Todo.findOne().sort({ position: 1 }).select('position').lean()
    const todo = await Todo.create({
      ...data,
      position:  (first?.position ?? 0) - 1,
      createdBy: req.user._id,
      updatedBy: req.user._id,
      completedAt: data.status === 'done' ? new Date() : undefined,
    })
    res.status(201).json(todo)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function update(req, res) {
  try {
    const todo = await Todo.findById(req.params.id)
    if (!todo) return res.status(404).json({ message: 'Tâche introuvable.' })

    const data = pick(req.body)
    if (data.status !== undefined) {
      if (!STATUSES.includes(data.status)) {
        return res.status(400).json({ message: 'Statut inconnu.' })
      }
      syncCompletion(todo, data.status)
    }
    if (data.validation !== undefined) {
      if (!VALIDATIONS.includes(data.validation)) {
        return res.status(400).json({ message: 'Validation inconnue.' })
      }
      syncValidation(todo, data.validation)
    }
    Object.assign(todo, data)
    todo.updatedBy = req.user._id
    await todo.save()

    res.json(todo)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* Réordonnancement complet : le client renvoie la liste des ids dans l'ordre
   voulu. Plus simple à raisonner qu'un échange deux à deux. */
async function reorder(req, res) {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids)) return res.status(400).json({ message: 'Liste attendue.' })
    await Todo.bulkWrite(ids.map((id, i) => ({
      updateOne: { filter: { _id: id }, update: { $set: { position: i } } },
    })))
    res.json({ message: 'Ordre enregistré.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function remove(req, res) {
  try {
    const todo = await Todo.findById(req.params.id)
    if (!todo) return res.status(404).json({ message: 'Tâche introuvable.' })

    // Les captures suivent la tâche : les laisser sur le disque ne sert rien.
    for (const name of todo.images || []) {
      fs.unlink(path.join(__dirname, '..', 'uploads', 'todos', name), () => {})
    }
    await todo.deleteOne()
    res.json({ message: 'Tâche supprimée.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function addImage(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' })
    const todo = await Todo.findById(req.params.id)
    if (!todo) {
      fs.unlink(req.file.path, () => {})
      return res.status(404).json({ message: 'Tâche introuvable.' })
    }
    todo.images.push(req.file.filename)
    todo.updatedBy = req.user._id
    await todo.save()
    /* `uploaded` : l'appelant insère l'image à l'endroit du curseur, il lui
       faut le nom du fichier sans avoir à deviner lequel vient d'arriver. */
    res.json({ ...todo.toObject(), uploaded: req.file.filename })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

async function removeImage(req, res) {
  try {
    const todo = await Todo.findById(req.params.id)
    if (!todo) return res.status(404).json({ message: 'Tâche introuvable.' })

    const { filename } = req.params
    todo.images = (todo.images || []).filter(n => n !== filename)
    todo.updatedBy = req.user._id
    await todo.save()
    fs.unlink(path.join(__dirname, '..', 'uploads', 'todos', filename), () => {})
    res.json(todo)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

module.exports = {
  getAll, create, update, reorder, remove, addImage, removeImage,
  /* Exporté pour être testable : c'est la barrière qui empêche du script
     collé depuis un mail d'atterrir dans la page. */
  sanitizeHtml,
}
