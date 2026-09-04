/**
 * Longueur minimale d'un mot de passe, en un seul endroit.
 *
 * La règle divergeait : 5 caractères à la création (modèle + validation de
 * route), 8 à la réinitialisation et dans l'interface. Un mot de passe accepté
 * par un écran était donc refusé par l'autre.
 *
 * Miroir : `backend/config/auth.js`.
 */
export const PASSWORD_MIN_LENGTH = 3
