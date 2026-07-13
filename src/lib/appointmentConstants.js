/* Constantes & helpers partagés entre le planning et les formations. */

export const ROLE_LABELS = {
  superadmin: 'Super admin', admin: 'Admin', technicien: 'Technicien',
  commercial: 'Commercial',  assistante: 'Assistante', readonly: 'Lecture seule',
}

export const TYPE_OPTS = [
  { value: 'controle',      label: 'Contrôle',      color: '#f97316' },
  { value: 'intervention',  label: 'Intervention',  color: '#ef4444' },
  { value: 'installation',  label: 'Installation',  color: '#22c55e' },
  { value: 'formation',     label: 'Formation',     color: '#a855f7' },
  { value: 'reunion',       label: 'Réunion',       color: '#3b82f6' },
  { value: 'autre',         label: 'Autre',         color: '#6b7280' },
]

export const STATUS_OPTS = [
  { value: 'planifie',  label: 'Planifié',  color: '#6b7280' },
  { value: 'en_cours',  label: 'En cours',  color: '#f97316' },
  { value: 'fait',      label: 'Fait',      color: '#22c55e' },
  { value: 'annule',    label: 'Annulé',    color: '#ef4444' },
]

// Types proposés dans la modal : contrôles/interventions/installations exclus
// (créés depuis leurs pages dédiées, mais affichés dans le planning quand même).
export const MODAL_TYPE_OPTS = TYPE_OPTS.filter(
  t => !['controle', 'intervention', 'installation'].includes(t.value)
)

// Durées prédéfinies (en minutes). 1 h par défaut.
export const DURATION_OPTS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 h' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 h' },
  { value: 180, label: '3 h' },
  { value: 240, label: '4 h' },
  { value: 480, label: 'Journée (8 h)' },
]

export const TYPE_MAP   = Object.fromEntries(TYPE_OPTS.map(t => [t.value, t]))
export const STATUS_MAP = Object.fromEntries(STATUS_OPTS.map(s => [s.value, s]))

/* ── Avatars ─────────────────────────────────────────────────── */

const AVATAR_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#f59e0b', '#ec4899']

export function avatarColor(str = '') {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

/* ── Dates ───────────────────────────────────────────────────── */

const pad2 = n => String(n).padStart(2, '0')

export function localDateStr(d) { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
export function localTimeStr(d) { d = new Date(d); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

export function formatTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Renvoie une liste de durées incluant `current` si elle n'est pas standard.
export function durationOptionsWith(current) {
  return DURATION_OPTS.some(o => o.value === current)
    ? DURATION_OPTS
    : [...DURATION_OPTS, { value: current, label: `${current} min` }].sort((a, b) => a.value - b.value)
}
