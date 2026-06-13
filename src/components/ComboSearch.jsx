import { useState, useRef, useEffect } from 'react'
import { Search, Plus, X, Check } from 'lucide-react'

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
 *  onCreateNew  - () => void  — shows [+] button if provided
 *  emptyText    - text when no results
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
        const main = (displayFn(item) || '').toLowerCase()
        const sub  = subtextFn ? (subtextFn(item) || '').toLowerCase() : ''
        const q    = query.toLowerCase()
        return main.includes(q) || sub.includes(q)
      })
    : items

  function select(item) {
    onChange(item)
    setOpen(false)
    setQuery('')
  }

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
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
        {onCreateNew && (
          <button
            type="button"
            className="combo-new-btn"
            onClick={onCreateNew}
            title="Créer nouveau"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="combo-dropdown">
          {filtered.length === 0 ? (
            <div className="combo-empty">
              <span>{emptyText}</span>
              {onCreateNew && (
                <button
                  type="button"
                  className="combo-empty-cta"
                  onClick={() => { setOpen(false); onCreateNew() }}
                >
                  <Plus size={12} /> Créer nouveau
                </button>
              )}
            </div>
          ) : (
            filtered.slice(0, 8).map((item, i) => (
              <button key={i} type="button" className="combo-option" onClick={() => select(item)}>
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
