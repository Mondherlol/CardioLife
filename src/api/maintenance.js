import { get, post } from './http'

/* Reprises de données lancées depuis les paramètres — super admin uniquement.
   Ce sont les mêmes opérations que les scripts du serveur. */

export const getMaintenanceTasks = () => get('/maintenance')

/* `dry` par défaut : sans `dry: false` explicite, le serveur se contente de
   simuler. On regarde, puis on écrit. */
export const runMaintenanceTask = (task, payload = {}) =>
  post(`/maintenance/${task}`, { dry: true, ...payload })
