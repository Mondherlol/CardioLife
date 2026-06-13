import { useEffect } from 'react'

export function useSwipeToOpen(onOpen, onClose, isOpen) {
  useEffect(() => {
    let startX = 0
    let startY = 0

    function onTouchStart(e) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }

    function onTouchEnd(e) {
      const endX = e.changedTouches[0].clientX
      const endY = e.changedTouches[0].clientY
      const dx   = endX - startX
      const dy   = Math.abs(endY - startY)

      // swipe droite depuis le bord gauche (< 30px) → ouvrir
      if (!isOpen && startX < 30 && dx > 60 && dy < 80) {
        onOpen()
      }
      // swipe gauche quand ouvert → fermer
      if (isOpen && dx < -60 && dy < 80) {
        onClose()
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend',   onTouchEnd)
    }
  }, [onOpen, onClose, isOpen])
}
