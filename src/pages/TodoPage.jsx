import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import { ListTodo, Plus, Search, Trash2, Loader } from 'lucide-react'
import {
  getTodos, createTodo, updateTodo, deleteTodo,
  uploadTodoImage, todoImageUrl,
} from '../api/todos'
import { useLoadingBar } from '../hooks/useLoadingBar'

/**
 * Suivi partagé des demandes, présenté comme une feuille de calcul.
 *
 * Six colonnes, pas une de plus : la demande, sa date, où elle en est, ce qu'on
 * a répondu, si l'équipe l'a validée, et ce qu'elle en dit. Tout se saisit dans
 * la cellule — aucun panneau à déplier, aucun formulaire à ouvrir. C'est la
 * condition pour que le tableau soit tenu à jour pendant une réunion.
 *
 * Les colonnes « Réponse » et « Retours » acceptent indifféremment du texte, un
 * lien ou une capture collée : un champ unique évite d'avoir à choisir un
 * format avant de pouvoir écrire.
 */

/* ─── Référentiels ──────────────────────────────────────────── */

const STATUSES = [
  { id: 'todo',  label: 'À faire',  cls: 'todo' },
  { id: 'doing', label: 'En cours', cls: 'doing' },
  { id: 'done',  label: 'Fait',     cls: 'done' },
]
const STATUS_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]))

/* Un clic fait avancer la ligne, un clic de plus corrige l'erreur. Plus rapide
   qu'un menu déroulant quand on parcourt vingt lignes. */
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo' }

const VALIDATIONS = [
  { id: 'pending', label: 'En attente', short: '—',  cls: 'pending' },
  { id: 'ok',      label: 'Validé',     short: '✓',  cls: 'ok' },
  { id: 'ko',      label: 'À revoir',   short: '✗',  cls: 'ko' },
]
const VALIDATION_BY_ID = Object.fromEntries(VALIDATIONS.map(v => [v.id, v]))
const NEXT_VALIDATION = { pending: 'ok', ok: 'ko', ko: 'pending' }

function isoDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10)
}

/* ─── Cellule libre (texte, liens, images) ──────────────────── */

/**
 * Cellule éditable acceptant du contenu collé.
 *
 * Le champ n'est pas piloté par React à chaque frappe : un `contentEditable`
 * re-rendu perd la position du curseur à chaque caractère. On pose le HTML à
 * l'ouverture, on lit à la sortie du champ.
 *
 * `document.execCommand` est déprécié mais reste le seul moyen simple
 * d'insérer au curseur en conservant l'annulation native du navigateur.
 */
function RichCell({ value, placeholder, onSave, onUploadImage }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const [vide, setVide] = useState(!value)

  // On ne réécrit le contenu que s'il a bougé côté serveur, et jamais pendant
  // la frappe — sinon le curseur saute.
  useEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    if (el.innerHTML !== (value || '')) el.innerHTML = value || ''
    setVide(!el.textContent.trim() && !el.querySelector('img'))
  }, [value])

  function save() {
    const html = ref.current?.innerHTML || ''
    setVide(!ref.current.textContent.trim() && !ref.current.querySelector('img'))
    if (html !== (value || '')) onSave(html)
  }

  async function insertImage(file) {
    setBusy(true)
    try {
      const url = await onUploadImage(file)
      ref.current?.focus()
      document.execCommand('insertHTML', false, `<img src="${url}" alt="">`)
      save()
    } catch (err) {
      toast.error(err.message || 'Envoi de l\'image impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePaste(e) {
    const dt = e.clipboardData
    const fichier = [...(dt?.items || [])]
      .find(i => i.kind === 'file' && i.type.startsWith('image/'))

    if (fichier) {
      e.preventDefault()
      await insertImage(fichier.getAsFile())
      return
    }

    const texte = dt?.getData('text/plain') || ''
    e.preventDefault()

    // Une URL collée devient un lien cliquable, sinon on colle en texte brut :
    // le HTML d'un mail ou de Word importe des styles qu'on ne veut pas.
    if (/^https?:\/\/\S+$/i.test(texte.trim())) {
      const u = texte.trim().replace(/"/g, '&quot;')
      document.execCommand('insertHTML', false,
        `<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`)
    } else {
      document.execCommand('insertText', false, texte)
    }
    save()
  }

  async function handleDrop(e) {
    const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    await insertImage(file)
  }

  return (
    <div className="tdt-rich-wrap">
      <div
        ref={ref}
        className={`tdt-rich${vide ? ' tdt-rich--empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onBlur={save}
        onInput={() => setVide(false)}
      />
      {busy && <span className="tdt-rich-busy"><Loader size={12} /> envoi…</span>}
    </div>
  )
}

/* ─── Ligne du tableau ──────────────────────────────────────── */

function TodoRow({ todo, onPatch, onUpload, onDelete }) {
  const statut = STATUS_BY_ID[todo.status] || STATUS_BY_ID.todo
  const valid  = VALIDATION_BY_ID[todo.validation] || VALIDATION_BY_ID.pending

  return (
    <tr className={`tdt-row tdt-row--${statut.cls}`}>
      {/* Demande */}
      <td className="tdt-td tdt-td--demande">
        <div
          className="tdt-title"
          contentEditable
          suppressContentEditableWarning
          onBlur={e => {
            const t = e.target.textContent.trim()
            if (t && t !== todo.title) onPatch(todo._id, { title: t })
            else e.target.textContent = todo.title
          }}
        >
          {todo.title}
        </div>
        {todo.notes && <div className="tdt-notes">{todo.notes}</div>}
        {todo.category && <span className="tdt-tag">{todo.category}</span>}
      </td>

      {/* Date de la demande */}
      <td className="tdt-td tdt-td--date">
        <input
          type="date"
          className="tdt-date-input"
          value={isoDate(todo.requestedAt)}
          onChange={e => onPatch(todo._id, { requestedAt: e.target.value || null })}
        />
      </td>

      {/* Statut */}
      <td className="tdt-td tdt-td--statut">
        <button
          type="button"
          className={`tdt-pill tdt-pill--${statut.cls}`}
          title={`Cliquer pour passer à « ${STATUS_BY_ID[NEXT_STATUS[todo.status]].label} »`}
          onClick={() => onPatch(todo._id, { status: NEXT_STATUS[todo.status] })}
        >
          {statut.label}
        </button>
      </td>

      {/* Réponse */}
      <td className="tdt-td tdt-td--rich">
        <RichCell
          value={todo.response}
          placeholder="Réponse — écrivez, collez un lien ou une capture"
          onSave={html => onPatch(todo._id, { response: html })}
          onUploadImage={file => onUpload(todo._id, file)}
        />
      </td>

      {/* Validé & testé par l'équipe */}
      <td className="tdt-td tdt-td--valid">
        <button
          type="button"
          className={`tdt-valid tdt-valid--${valid.cls}`}
          title={`${valid.label} — cliquer pour « ${VALIDATION_BY_ID[NEXT_VALIDATION[todo.validation || 'pending']].label} »`}
          onClick={() => onPatch(todo._id, {
            validation: NEXT_VALIDATION[todo.validation || 'pending'],
          })}
        >
          <span className="tdt-valid-mark">{valid.short}</span>
          <span className="tdt-valid-label">{valid.label}</span>
        </button>
      </td>

      {/* Retours */}
      <td className="tdt-td tdt-td--rich">
        <RichCell
          value={todo.feedback}
          placeholder="Retours de l'équipe"
          onSave={html => onPatch(todo._id, { feedback: html })}
          onUploadImage={file => onUpload(todo._id, file)}
        />
      </td>

      <td className="tdt-td tdt-td--actions">
        <button
          type="button"
          className="action-btn action-btn--destroy"
          title="Supprimer la ligne"
          onClick={() => onDelete(todo)}
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

/* ─── Page ──────────────────────────────────────────────────── */

export default function TodoPage() {
  const [todos, setTodos]     = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [confirm, setConfirm] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding]   = useState(false)

  useLoadingBar(loading)

  const refresh = useCallback(async () => {
    try {
      setTodos(await getTodos())
    } catch (err) {
      toast.error(err.message || 'Impossible de charger le suivi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const counts = useMemo(() => ({
    todo:  todos.filter(t => t.status === 'todo').length,
    doing: todos.filter(t => t.status === 'doing').length,
    done:  todos.filter(t => t.status === 'done').length,
    ok:    todos.filter(t => t.validation === 'ok').length,
  }), [todos])

  /* Les plus récentes en tête. Le serveur trie déjà ainsi ; on le refait ici
     pour qu'une ligne créée à l'instant se place au bon endroit sans recharger. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rang = t => new Date(t.requestedAt || t.createdAt || 0).getTime()
    return todos
      .filter(t => {
        if (['todo', 'doing', 'done'].includes(filter) && t.status !== filter) return false
        if (filter === 'open' && t.status === 'done') return false
        if (!q) return true
        return [t.title, t.notes, t.category, t.response, t.feedback]
          .filter(Boolean).join(' ').toLowerCase().includes(q)
      })
      .sort((a, b) => rang(b) - rang(a))
  }, [todos, filter, search])

  /* Mise à jour optimiste : cocher doit être instantané. En cas d'échec on
     recharge — la vérité reste au serveur. */
  async function patchTodo(id, data) {
    setTodos(list => list.map(t => (t._id === id ? { ...t, ...data } : t)))
    try {
      const saved = await updateTodo(id, data)
      setTodos(list => list.map(t => (t._id === id ? saved : t)))
    } catch (err) {
      toast.error(err.message || 'Enregistrement impossible.')
      refresh()
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    const titre = newTitle.trim()
    if (!titre) return
    setAdding(true)
    try {
      const created = await createTodo({
        title: titre,
        // Une demande saisie aujourd'hui est datée d'aujourd'hui : sans date
        // elle tomberait en bas du tableau.
        requestedAt: new Date().toISOString().slice(0, 10),
      })
      setTodos(list => [created, ...list])
      setNewTitle('')
    } catch (err) {
      toast.error(err.message || 'Création impossible.')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(todo) {
    try {
      await deleteTodo(todo._id)
      setTodos(list => list.filter(t => t._id !== todo._id))
      setConfirm(null)
    } catch (err) {
      toast.error(err.message || 'Suppression impossible.')
    }
  }

  /** Renvoie l'URL de l'image téléversée, pour insertion dans la cellule. */
  async function handleUpload(id, file) {
    const saved = await uploadTodoImage(id, file)
    setTodos(list => list.map(t => (t._id === id ? { ...t, images: saved.images } : t)))
    return todoImageUrl(saved.uploaded)
  }

  const TABS = [
    { id: 'all',   label: 'Tout',     count: todos.length },
    { id: 'open',  label: 'Ouvertes', count: counts.todo + counts.doing },
    { id: 'todo',  label: 'À faire',  count: counts.todo },
    { id: 'doing', label: 'En cours', count: counts.doing },
    { id: 'done',  label: 'Fait',     count: counts.done },
  ]

  const total = todos.length
  const pct   = total ? Math.round((counts.done / total) * 100) : 0

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title"><ListTodo size={20} strokeWidth={1.8} /> Suivi &amp; To-do</h1>
          <p className="page-subtitle">
            Demandes d'évolution et correctifs, les plus récentes en haut.
            Chaque cellule se modifie directement.
          </p>
        </div>
        {total > 0 && (
          <div className="tdt-progress">
            <div className="tdt-progress-bar"><span style={{ width: `${pct}%` }} /></div>
            <span className="tdt-progress-text">
              {counts.done}/{total} faites · {counts.ok} validées par l'équipe
            </span>
          </div>
        )}
      </div>

      <form className="tdt-quickadd" onSubmit={handleAdd}>
        <Plus size={16} className="tdt-quickadd-icon" />
        <input
          className="tdt-quickadd-input"
          placeholder="Nouvelle demande, puis Entrée…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
        />
        <button className="btn btn--primary" disabled={adding || !newTitle.trim()}>
          {adding ? <span className="spinner spinner--sm" /> : 'Ajouter'}
        </button>
      </form>

      <div className="tdt-toolbar">
        <div className="stock-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`stock-tab${filter === t.id ? ' stock-tab--active' : ''}`}
              onClick={() => setFilter(t.id)}
            >
              {t.label} <span className="tdt-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="tdt-search">
          <Search size={14} className="tdt-search-icon" />
          <input
            className="form-input"
            placeholder="Rechercher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : visible.length === 0 ? (
        <div className="table-empty">
          <ListTodo size={36} color="var(--gray-300)" />
          <p>{total === 0 ? 'Aucune demande pour le moment.' : 'Aucune ligne pour ce filtre.'}</p>
        </div>
      ) : (
        <div className="tdt-wrap">
          <table className="tdt">
            <thead>
              <tr>
                <th className="tdt-th tdt-th--demande">Demande</th>
                <th className="tdt-th tdt-th--date">Date</th>
                <th className="tdt-th tdt-th--statut">Statut</th>
                <th className="tdt-th tdt-th--rich">Réponse</th>
                <th className="tdt-th tdt-th--valid">Validé &amp; testé</th>
                <th className="tdt-th tdt-th--rich">Retours</th>
                <th className="tdt-th tdt-th--actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map(t => (
                <TodoRow
                  key={t._id}
                  todo={t}
                  onPatch={patchTodo}
                  onUpload={handleUpload}
                  onDelete={setConfirm}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal modal--sm">
            <div className="modal-header">
              <h2 className="modal-title">Supprimer la ligne</h2>
            </div>
            <div className="modal-body">
              <p>« {confirm.title} » sera supprimée définitivement, avec ses captures.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn--ghost" onClick={() => setConfirm(null)}>Annuler</button>
              <button className="btn btn--danger" onClick={() => handleDelete(confirm)}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
