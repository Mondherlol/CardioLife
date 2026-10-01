import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

/**
 * Chargement au fil du défilement — remplace la pagination des listes.
 *
 * Une sentinelle posée en fin de liste déclenche le lot suivant dès qu'elle
 * devient visible à l'écran. Elle est observée par rapport à la fenêtre, pas
 * à un conteneur : selon la page, c'est le tableau qui défile ou la page
 * entière, et l'observateur tient compte tout seul de chaque conteneur qui la
 * masque. L'anticipation vient de la sentinelle elle-même — une bande
 * invisible qui remonte au-dessus du pied de liste (voir `.list-sentinel`) :
 * le lot part avant que l'utilisateur n'atteigne le bas.
 */

/** Valeur qui ne suit la saisie qu'après `delay` ms sans frappe — une requête par recherche, pas par lettre. */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/**
 * Sentinelle de fin de liste. `onReach` est appelé quand elle devient visible
 * — et rappelé à chaque `recheck` tant qu'elle le reste : sur un grand écran,
 * un lot ne suffit pas toujours à la repousser hors de vue, et l'observateur,
 * lui, ne se manifeste qu'aux changements.
 */
function useSentinel(onReach, recheck) {
  const [node, setNode] = useState(null)
  const visible = useRef(false)
  const reach = useRef(onReach)
  reach.current = onReach

  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting
      if (entry.isIntersecting) reach.current()
    })
    io.observe(node)
    return () => { visible.current = false; io.disconnect() }
  }, [node])

  useEffect(() => {
    if (visible.current) reach.current()
  }, [recheck])

  return setNode
}

/**
 * Liste paginée côté serveur, chargée lot par lot.
 *
 * `fetchPage({ skip, limit })` rend `{ data, total }`. Le premier lot part au
 * montage puis à chaque changement de `deps` (recherche, tri, onglet). Une
 * réponse arrivée après un changement de critères est ignorée : une requête
 * lente ne doit pas remplacer la liste de la recherche suivante.
 *
 * `initialCount` recharge d'un coup ce qui était affiché avant de quitter la
 * page — au retour d'une fiche, la liste et le défilement se retrouvent tels
 * quels au lieu de repartir du premier lot.
 */
export function useInfiniteList(fetchPage, deps, { pageSize = 30, initialCount = 0 } = {}) {
  const [items,       setItems]       = useState([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)    // premier lot : la liste n'a rien à montrer
  const [loadingMore, setLoadingMore] = useState(false)   // lots suivants : la liste reste en place
  const [error,       setError]       = useState('')

  const fetchRef   = useRef(fetchPage)
  const itemsRef   = useRef(items)
  const totalRef   = useRef(total)
  const errorRef   = useRef('')
  const generation = useRef(0)
  const busy       = useRef(false)
  const firstLimit = useRef(Math.max(pageSize, initialCount || 0))
  fetchRef.current = fetchPage
  itemsRef.current = items
  totalRef.current = total

  const run = useCallback(async ({ reset, limit, silent = false }) => {
    if (!reset && busy.current) return
    const mine = reset ? ++generation.current : generation.current
    busy.current = true
    errorRef.current = ''
    setError('')
    if (reset && !silent) setLoading(true)
    if (!reset) setLoadingMore(true)
    try {
      const res  = await fetchRef.current({ skip: reset ? 0 : itemsRef.current.length, limit })
      if (mine !== generation.current) return
      const data = Array.isArray(res?.data) ? res.data : []
      setTotal(res?.total ?? data.length)
      setItems(prev => {
        if (reset) return data
        // Une ligne ajoutée ou retirée entre deux lots décale le suivant : on
        // ne laisse pas passer de doublon.
        const seen = new Set(prev.map(x => x._id))
        return prev.concat(data.filter(x => !seen.has(x._id)))
      })
    } catch (err) {
      if (mine !== generation.current) return
      errorRef.current = err.message || 'Chargement impossible.'
      setError(errorRef.current)
    } finally {
      if (mine === generation.current) {
        busy.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  const loadMore = useCallback(() => {
    // Une erreur arrête le chargement automatique : sans quoi la sentinelle
    // toujours visible relancerait la requête en boucle.
    if (busy.current || errorRef.current) return
    if (itemsRef.current.length >= totalRef.current) return
    run({ reset: false, limit: pageSize })
  }, [run, pageSize])

  useEffect(() => {
    run({ reset: true, limit: firstLimit.current })
    firstLimit.current = pageSize   // la restauration ne vaut que pour le premier affichage
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  /** Recharge ce qui est affiché sans vider l'écran — après une action sur une ligne. */
  const reload = useCallback(() => run({
    reset: true, silent: true, limit: Math.max(pageSize, itemsRef.current.length),
  }), [run, pageSize])

  /** Relance après une erreur, là où la liste s'était arrêtée. */
  const retry = useCallback(() => {
    errorRef.current = ''
    if (itemsRef.current.length === 0) run({ reset: true, limit: pageSize })
    else run({ reset: false, limit: pageSize })
  }, [run, pageSize])

  const sentinelRef = useSentinel(loadMore, `${items.length}:${loading}:${loadingMore}`)

  return {
    items, setItems, total, loading, loadingMore, error,
    hasMore: items.length < total,
    loadMore, reload, retry, sentinelRef,
  }
}

/**
 * Liste déjà chargée en entier, rendue progressivement.
 *
 * Quelques centaines de lignes filtrées côté client n'ont pas besoin d'être
 * redemandées au serveur, mais les monter d'un coup alourdit chaque frappe dans
 * la recherche. On en rend `step`, puis `step` de plus à l'approche du bas ;
 * tout changement de `resetKey` (filtre, tri) repart du début.
 */
export function useProgressiveList(items, { step = 50, resetKey } = {}) {
  const [count, setCount] = useState(step)
  const lengthRef = useRef(items.length)
  lengthRef.current = items.length

  useEffect(() => { setCount(step) }, [resetKey, step])

  const more = useCallback(() => {
    setCount(c => (c < lengthRef.current ? c + step : c))
  }, [step])

  const visible     = useMemo(() => items.slice(0, count), [items, count])
  const sentinelRef = useSentinel(more, count)

  return { visible, shown: visible.length, hasMore: count < items.length, sentinelRef }
}
