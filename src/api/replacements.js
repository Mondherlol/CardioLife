import { get, post, patch, del } from './http'

/* Libellés partagés par la modale, la liste et la fiche du site : un même
   remplacement doit se lire pareil partout. */
export const REPLACEMENT_KINDS = [
  { value: 'dae',        label: 'Défibrillateur', field: 'serialNumber' },
  { value: 'batterie',   label: 'Batterie',       field: 'serialNumber' },
  { value: 'electrodes', label: 'Électrodes',     field: 'lotNumber' },
]

export const REPLACEMENT_STATUSES = [
  { value: 'a_remplacer', label: 'À remplacer', tone: 'ember' },
  { value: 'remplace',    label: 'Remplacé',    tone: 'mint'  },
  { value: 'annule',      label: 'Annulé',      tone: 'slate' },
]

export const REPLACEMENT_REASONS = [
  { value: 'defectueux', label: 'Défectueux' },
  { value: 'perime',     label: 'Périmé' },
  { value: 'manquant',   label: 'Manquant' },
  { value: 'endommage',  label: 'Endommagé' },
  { value: 'fin_de_vie', label: 'Fin de vie' },
  { value: 'autre',      label: 'Autre' },
]

export const replacementKind   = v => REPLACEMENT_KINDS.find(k => k.value === v)    || { value: v, label: v, field: 'serialNumber' }
export const replacementStatus = v => REPLACEMENT_STATUSES.find(s => s.value === v) || { value: v, label: v, tone: 'slate' }
export const replacementReason = v => REPLACEMENT_REASONS.find(r => r.value === v)  || { value: v, label: v }

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)
  ).toString()
  return s ? `?${s}` : ''
}

export const getReplacements   = (params = {}) => get(`/replacements${qs(params)}`)
export const getReplacement    = (id)          => get(`/replacements/${id}`)
export const createReplacement = (data)        => post('/replacements', data)
export const updateReplacement = (id, data)    => patch(`/replacements/${id}`, data)
export const deleteReplacement = (id)          => del(`/replacements/${id}`)
