import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

/**
 * Bouton « retour » qui ramène là d'où l'on vient.
 *
 * Une même fiche s'ouvre depuis plusieurs écrans (un contrôle depuis la fiche
 * client, celle d'un site, un contrat, le planning, la liste…) : renvoyer vers
 * une liste figée fait perdre sa place au lecteur. On remonte donc l'historique.
 *
 * `fallback` ne sert qu'au premier écran de la session — lien direct, favori ou
 * rechargement : il n'y a alors rien derrière, et revenir en arrière sortirait
 * de l'application.
 */
export function useGoBack(fallback) {
  const navigate = useNavigate()
  const location = useLocation()

  // React Router marque « default » la toute première entrée de l'historique.
  const hasHistory = location.key !== 'default'

  return useCallback(() => {
    if (hasHistory) navigate(-1)
    else navigate(fallback)
  }, [hasHistory, navigate, fallback])
}
