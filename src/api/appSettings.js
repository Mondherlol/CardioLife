import { get, put, post, del, upload, STATIC_BASE } from './http'

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
