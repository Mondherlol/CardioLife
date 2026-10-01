import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Pied d'une liste chargée au défilement.
 *
 * Porte la sentinelle qui déclenche le lot suivant, et dit où l'on en est :
 * « 45 sur 107 clients » pendant le chargement, « 107 clients » une fois tout
 * affiché. Une erreur arrête le chargement automatique et propose de relancer.
 *
 * `noun` : [singulier, pluriel].
 */
export default function ListFooter({
  sentinelRef, shown, total, hasMore, loadingMore, error, onRetry, noun = ['élément', 'éléments'],
}) {
  const word = n => (n > 1 ? noun[1] : noun[0])

  return (
    <div className="list-footer">
      <div ref={sentinelRef} className="list-sentinel" aria-hidden="true" />
      {error ? (
        <span className="list-footer-error">
          <AlertTriangle size={13} /> {error}
          {onRetry && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
              <RotateCcw size={12} /> Réessayer
            </button>
          )}
        </span>
      ) : hasMore || loadingMore ? (
        <span className="list-footer-more">
          <span className="spinner list-footer-spinner" />
          {shown} sur {total} {word(total)}
        </span>
      ) : total > 0 ? (
        <span className="list-footer-end">{total} {word(total)}</span>
      ) : null}
    </div>
  )
}
