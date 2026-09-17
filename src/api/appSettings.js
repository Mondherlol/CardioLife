import { get, put, post, del, upload, download, STATIC_BASE, API_BASE } from './http'

export const getAppSettings    = ()    => get('/app-settings')
export const updateAppSettings = (data) => put('/app-settings', data)

/* ── Logo de l'entreprise ─────────────────────────────────────
   Servi depuis l'API et non depuis le site public : les documents doivent
   s'imprimer et se convertir en PDF sans dépendre d'un domaine tiers. */

export const uploadCompanyLogo = (file) => {
  const form = new FormData()
  form.append('logo', file)
  return upload('/app-settings/logo', form)
}

export const deleteCompanyLogo = () => del('/app-settings/logo')

/** Logo à afficher : celui de l'entreprise, sinon celui livré avec l'app. */
export const companyLogoUrl = (logo) =>
  (logo ? `${STATIC_BASE}/uploads/company/${logo}` : '/logo-cardiolife.jpg')

/* Remise à zéro des données métier — les comptes utilisateurs sont conservés.
   `confirm` doit valoir « REINITIALISER », le serveur refuse sans. */
export const resetDatabase = (payload) => post('/app-settings/reset', payload)

/* ── Sauvegarde complète (base + fichiers) ──────────────────────
   Super admin uniquement. Le zip contient tout, comptes compris. */

export const downloadBackup = () => download('/app-settings/backup', 'cardiotrack-backup.zip')

/**
 * Restauration : remplace toute la base et tous les fichiers. XHR plutôt que
 * fetch pour suivre l'envoi — l'archive pèse vite plusieurs centaines de Mo.
 * `confirm` doit valoir « RESTAURER ».
 */
export function restoreBackup(file, confirm, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    // Avant le fichier : multer ne remplit `req.body` qu'avec les champs déjà lus.
    form.append('confirm', confirm)
    form.append('backup', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/app-settings/backup/restore`)
    const token = sessionStorage.getItem('token')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* réponse vide */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.message || 'La restauration a échoué.'))
    }
    xhr.onerror = () => reject(new Error('Connexion interrompue pendant l’envoi.'))
    xhr.send(form)
  })
}
