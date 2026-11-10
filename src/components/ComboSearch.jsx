import { useState, useRef, useEffect } from 'react'
import { Search, Plus, X, Check } from 'lucide-react'
import { fold } from '../lib/text'
import { useListKeyboard } from '../hooks/useListKeyboard'

/**
 * Generic searchable combobox.
 * Props:
 *  items        - array of items
 *  value        - selected item (object) or null
 *  onChange     - (item) => void when item selected
 *  onClear      - () => void when selection cleared
 *  displayFn    - (item) => string  — main display text
 *  subtextFn    - (item) => string  — secondary text (optional)
 *  placeholder  - input placeholder
 *  onCreateNew  - (query) => void  — shows [+] button if provided ; reçoit la
 *                 saisie en cours, ce qui permet de proposer « créer « X » »
 *  emptyText    - text when no results
 *  emptyCtaLabel- (query) => string — libellé du bouton de création
 *  onQueryChange- (query) => void — remonte la saisie au parent, pour les cas
 *                 où une valeur absente de la liste doit être traitée
 *  disabled     - boolean
 */
export default function ComboSearch({
  items = [],
  value,
  onChange,
  onClear,
  displayFn,
  subtextFn,
  placeholder = 'Rechercher…',
  onCreateNew,
  emptyText = 'Aucun résultat',
  emptyCtaLabel,
  onQueryChange,
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const filtered = query
    ? items.filter(item => {
        // Accents et casse ignorés : « lycee » trouve « LYCÉE ».
        const main = fold(displayFn(item))
        const sub  = subtextFn ? fold(subtextFn(item)) : ''
        const q    = fold(query)
        return main.includes(q) || sub.includes(q)
      })
    : items

  function setSearch(q) {
    setQuery(q)
    onQueryChange?.(q)
  }

  function select(item) {
    onChange(item)
    setOpen(false)
    setSearch('')
  }

  // ↑ ↓ pour parcourir, Entrée pour choisir, Échap pour fermer.
  const shown = filtered.slice(0, 8)
  const kb = useListKeyboard({
    count: shown.length, open, resetKey: query,
    onPick: i => shown[i] && select(shown[i]),
    onClose: () => setOpen(false),
  })

  /* ── Selected state ── */
  if (value) {
    return (
      <div className="combo-selected">
        <div className="combo-selected-check"><Check size={13} /></div>
        <div className="combo-selected-info">
          <span className="combo-selected-name">{displayFn(value)}</span>
          {subtextFn?.(value) && <span className="combo-selected-sub">{subtextFn(value)}</span>}
        </div>
        {!disabled && (
          <button type="button" className="combo-clear-btn" onClick={onClear} title="Changer">
            <X size={13} />
          </button>
        )}
      </div>
    )
  }

  /* ── Search state ── */
  return (
    <div className="combo-wrap" ref={wrapRef}>
      <div className="combo-input-row">
        <div className="combo-input-box">
          <Search size={14} className="combo-icon" />
          <input
            className="combo-input"
            placeholder={placeholder}
            value={query}
            onChange={e => { setSearch(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={kb.onKeyDown}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
        {onCreateNew && (
          <button
            type="button"
            className="combo-new-btn"
            onClick={() => onCreateNew(query)}
            title="Créer nouveau"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="combo-dropdown" ref={kb.listRef}>
          {filtered.length === 0 ? (
            <div className="combo-empty">
              <span>{emptyText}</span>
              {onCreateNew && (
                <button
                  type="button"
                  className="combo-empty-cta"
                  onClick={() => { setOpen(false); onCreateNew(query) }}
                >
                  <Plus size={12} /> {emptyCtaLabel ? emptyCtaLabel(query) : 'Créer nouveau'}
                </button>
              )}
            </div>
          ) : (
            shown.map((item, i) => (
              <button key={i} type="button" data-kb-option
                className={`combo-option${kb.active === i ? ' combo-option--active' : ''}`}
                onMouseEnter={() => kb.setActive(i)}
                onClick={() => select(item)}>
                <span className="combo-option-main">{displayFn(item)}</span>
                {subtextFn?.(item) && (
                  <span className="combo-option-sub">{subtextFn(item)}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
