import { useState, useEffect, useRef } from 'react'
import { Search, X, ChevronDown, Check } from 'lucide-react'
import { getClients } from '../api/clients'
import { ROLE_LABELS, avatarColor, initials } from '../lib/appointmentConstants'

/* ── Client search autocomplete ─────────────────────────────── */

export function ClientSearchInput({ clientId, clientName, onChange }) {
  const [query,   setQuery]   = useState(clientName || '')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapRef  = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    if (clientId) onChange(null)          // unselect on retype
    setOpen(true)
    clearTimeout(timerRef.current)
    if (!q.trim()) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await getClients({ q, limit: 8 })
        setResults(data.data || [])
      } catch { setResults([]) }
      finally  { setLoading(false) }
    }, 280)
  }

  function handleSelect(c) {
    onChange({ id: c._id, name: c.name })
    setQuery(c.name)
    setOpen(false)
    setResults([])
  }

  function handleClear() {
    onChange(null)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="plan-client-wrap" ref={wrapRef}>
      <div className="plan-client-field">
        <Search size={13} className="plan-client-ico" />
        <input
          className="plan-client-input"
          value={query}
          onChange={handleChange}
          onFocus={() => { if (query.trim() && !clientId) setOpen(true) }}
          placeholder="Rechercher un client…"
          autoComplete="off"
        />
        {(clientId || query) && (
          <button type="button" className="plan-client-clear" onClick={handleClear}>
            <X size={12} />
          </button>
        )}
      </div>
      {clientId && (
        <div className="plan-client-badge">
          <span>{query}</span>
        </div>
      )}
      {open && (
        <div className="plan-client-dropdown">
          {loading && <div className="plan-client-msg">Recherche…</div>}
          {!loading && results.length === 0 && query.trim() && (
            <div className="plan-client-msg">Aucun résultat</div>
          )}
          {results.map(c => (
            <button key={c._id} type="button" className="plan-client-option"
              onClick={() => handleSelect(c)}>
              <span className="plan-client-opt-name">{c.name}</span>
              {c.address?.city && <span className="plan-client-opt-sub">{c.address.city}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Assigned-to multi-select ───────────────────────────────── */

export function AssignedToInput({ selected, onChange, users }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function toggle(user) {
    const already = selected.some(s => s._id === user._id)
    onChange(already
      ? selected.filter(s => s._id !== user._id)
      : [...selected, { _id: user._id, fullName: user.fullName }]
    )
  }

  function remove(id, e) {
    e.stopPropagation()
    onChange(selected.filter(s => s._id !== id))
  }

  return (
    <div className="plan-assign-wrap" ref={wrapRef}>
      <div className={`plan-assign-field${open ? ' plan-assign-field--open' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0 ? (
          <span className="plan-assign-placeholder">Assigner des personnes…</span>
        ) : (
          <div className="plan-assign-chips">
            {selected.map(u => (
              <span key={u._id} className="plan-assign-chip"
                style={{ background: avatarColor(u.fullName) }}>
                {initials(u.fullName)}
                <button type="button" className="plan-assign-chip-rm"
                  onClick={e => remove(u._id, e)}><X size={9} /></button>
              </span>
            ))}
          </div>
        )}
        <ChevronDown size={13}
          className={`plan-assign-chevron${open ? ' plan-assign-chevron--open' : ''}`} />
      </div>

      {open && (
        <div className="plan-assign-dropdown">
          {users.length === 0 && (
            <div className="plan-client-msg">Aucun utilisateur disponible</div>
          )}
          {users.map(u => {
            const isOn = selected.some(s => s._id === u._id)
            return (
              <button key={u._id} type="button"
                className={`plan-assign-option${isOn ? ' plan-assign-option--on' : ''}`}
                onClick={() => toggle(u)}>
                <span className="plan-assign-check">{isOn && <Check size={11} />}</span>
                <span className="plan-assign-av" style={{ background: avatarColor(u.fullName) }}>
                  {initials(u.fullName)}
                </span>
                <div className="plan-assign-info">
                  <span className="plan-assign-name">{u.fullName}</span>
                  <span className="plan-assign-role">{ROLE_LABELS[u.role] || u.role}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
