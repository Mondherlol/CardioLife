import { useState, useEffect, useRef } from 'react'

/**
 * Navigation au clavier dans une liste de suggestions : ↑ / ↓ déplacent la
 * surbrillance, Entrée choisit, Échap ferme. Entrée ne soumet jamais le
 * formulaire autour tant que la liste est ouverte.
 *
 *   const kb = useListKeyboard({ count, open, onPick: i => …, onClose })
 *   <input onKeyDown={kb.onKeyDown} />
 *   <div ref={kb.listRef}>{items.map((x, i) => <button className={kb.active === i ? '… --active' : '…'}
 *        onMouseEnter={() => kb.setActive(i)} />)}</div>
 *
 * La première suggestion est en surbrillance d'office : taper puis Entrée
 * prend le premier résultat.
 */
export function useListKeyboard({ count, open, onPick, onClose, resetKey }) {
  const [active, setActive] = useState(0)
  const listRef = useRef(null)

  // Nouvelle saisie, nouveaux résultats : on repart du premier.
  useEffect(() => { setActive(0) }, [resetKey, count, open])

  // L'option en surbrillance reste visible quand la liste défile.
  useEffect(() => {
    const el = listRef.current?.querySelectorAll('[data-kb-option]')?.[active]
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function onKeyDown(e) {
    if (!open || !count) {
      if (e.key === 'Escape' && open) { e.preventDefault(); onClose?.() }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1) % count)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i - 1 + count) % count)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onPick(Math.min(active, count - 1))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  return { active, setActive, onKeyDown, listRef }
}
