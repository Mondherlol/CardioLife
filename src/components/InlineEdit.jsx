import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'

/**
 * Cellule éditable en place : on survole, on clique, on tape, on valide.
 * Entrée / perte de focus enregistrent, Échap annule.
 *
 * Props :
 *  value       - valeur brute éditée (string ; 'yyyy-mm-dd' pour une date)
 *  display     - rendu en lecture (défaut : la valeur brute)
 *  type        - 'text' | 'date'
 *  placeholder - texte affiché quand la valeur est vide
 *  list        - id d'un <datalist> pour l'autocomplétion
 *  align       - 'left' (défaut) | 'center'
 *  onSave      - (value) => Promise ; rejette pour annuler la saisie
 */
export default function InlineEdit({
  value = '', display, type = 'text', placeholder = '—', list, align, onSave,
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef(null)
  // Empêche un double enregistrement quand Entrée déclenche aussi le blur.
  const committedRef = useRef(false)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (type !== 'date') el.select()
  }, [editing, type])

  function start() {
    committedRef.current = false
    setDraft(value)
    setEditing(true)
  }

  async function commit() {
    if (committedRef.current) return
    committedRef.current = true

    const next = type === 'date' ? draft : draft.trim()
    if (next === (value || '')) { setEditing(false); return }

    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch {
      // L'erreur est remontée par l'appelant ; on garde la saisie pour correction.
      committedRef.current = false
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    committedRef.current = true
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        list={list}
        className={`inline-input${align === 'center' ? ' inline-input--center' : ''}`}
        value={draft}
        disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        onClick={e => e.stopPropagation()}
      />
    )
  }

  const isEmpty = !value
  return (
    <button
      type="button"
      className={`inline-cell${isEmpty ? ' inline-cell--empty' : ''}${align === 'center' ? ' inline-cell--center' : ''}`}
      title="Cliquer pour modifier"
      onClick={e => { e.stopPropagation(); start() }}
    >
      <span className="inline-cell-value">{isEmpty ? placeholder : (display ?? value)}</span>
      <Pencil size={11} className="inline-cell-pencil" />
    </button>
  )
}
