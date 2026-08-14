import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Menu contextuel positionné au curseur.
 * Props :
 *  x, y    - position d'ouverture (coordonnées viewport)
 *  items   - [{ key, label, icon: Component, onClick, danger, disabled } | { separator: true }]
 *  title   - libellé d'en-tête optionnel (ex : nom du site)
 *  onClose - () => void
 */
export default function ContextMenu({ x, y, items, title, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  /* On rabat le menu dans la fenêtre une fois sa taille connue. */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth  - width  - margin)),
      top:  Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
      ready: true,
    })
  }, [x, y])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    // Un clic (y compris droit) hors du menu, un scroll ou un redimensionnement
    // ferment le menu : sa position n'aurait plus de sens.
    function onPointer(e) { if (!ref.current?.contains(e.target)) onClose() }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('contextmenu', onPointer)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('contextmenu', onPointer)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={e => e.preventDefault()}
      // Le menu se superpose souvent à un élément cliquable : aucun clic ne doit
      // le traverser pour déclencher l'action de la ligne en dessous.
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {title && <div className="ctx-menu-title">{title}</div>}
      {items.map((item, i) => {
        if (item.separator) return <div key={`sep-${i}`} className="ctx-menu-sep" />
        const Icon = item.icon
        return (
          <button
            key={item.key || item.label}
            type="button"
            className={`ctx-menu-item${item.danger ? ' ctx-menu-item--danger' : ''}`}
            disabled={item.disabled}
            onClick={() => { onClose(); item.onClick() }}
          >
            {Icon && <Icon size={14} />}
            {item.label}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
