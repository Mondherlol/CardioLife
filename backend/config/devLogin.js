/**
 * Compte développeur — raccourci de connexion.
 *
 * Se connecter avec l'identifiant et le mot de passe définis ici ouvre une
 * session « superadmin » qui a accès à tout, sans avoir à créer le compte à la
 * main ni à retenir le mot de passe d'un vrai utilisateur.
 *
 * Les deux valeurs se règlent dans `.env` (`DEV_LOGIN_USERNAME`,
 * `DEV_LOGIN_PASSWORD`). Laisser `DEV_LOGIN_PASSWORD` vide — ou supprimer la
 * ligne — désactive complètement le raccourci : c'est l'interrupteur à couper
 * avant une mise en production, sinon n'importe qui connaissant ces deux
 * valeurs est admin.
 */

const DEV_USERNAME = (process.env.DEV_LOGIN_USERNAME || '@dev').trim().toLowerCase()
const DEV_PASSWORD = process.env.DEV_LOGIN_PASSWORD || ''

/** Le raccourci n'existe que si un mot de passe est réellement défini. */
const isDevLoginEnabled = () => DEV_PASSWORD.length > 0

/** Vrai uniquement si l'identifiant ET le mot de passe correspondent. */
function matchesDevLogin(username, password) {
  if (!isDevLoginEnabled()) return false
  return String(username || '').trim().toLowerCase() === DEV_USERNAME
      && String(password || '')                      === DEV_PASSWORD
}

module.exports = { DEV_USERNAME, isDevLoginEnabled, matchesDevLogin }
