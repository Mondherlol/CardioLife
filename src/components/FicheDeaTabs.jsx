import { Zap, Check, Plus, Trash2, MapPin } from 'lucide-react'

/** Clé stable d'une fiche : l'_id du DAE, ou '' pour une fiche sans appareil. */
export const deaKey = d => String(d?._id || d?.dea || '')

export function deaLabel(dea) {
  if (!dea) return 'Appareil non précisé'
  return [dea.deviceType || 'DAE', dea.serialNumber].filter(Boolean).join(' · ')
}

/* Champs qui disent qu'une fiche a été travaillée — sert au repère
   d'avancement, pas à une validation : rien n'est obligatoire. */
const PROGRESS_FIELDS = [
  'serialNumber', 'batteriePeremption', 'batteriePct', 'batterieEtat',
  'electrodesPeremptionAdulte', 'electrodesEmballage', 'electrodesAdaptees',
  'voyantVert', 'autotests', 'armoireAccessible', 'observation',
]

export function ficheProgress(f) {
  if (!f) return 0
  const done = PROGRESS_FIELDS.filter(k => {
    const v = f[k]
    return v !== undefined && v !== null && v !== ''
  }).length
  return Math.round((done / PROGRESS_FIELDS.length) * 100)
}

/**
 * Les appareils contrôlés pendant la visite.
 *
 * Une visite de contrat porte sur tout un site : le technicien passe d'un DAE
 * à l'autre sans quitter la fiche, et voit d'un coup d'œil ce qui lui reste à
 * remplir. Sur mobile, la barre défile horizontalement plutôt que de
 * s'empiler — le pouce y navigue mieux.
 */
export default function FicheDeaTabs({
  entries, activeKey, onSelect, onAdd, onRemove, addable = [], readOnly,
}) {
  return (
    <div className="fdt">
      <div className="fdt-head">
        <span className="fdt-title"><Zap size={13} /> Appareils contrôlés ({entries.length})</span>
        {!readOnly && addable.length > 0 && (
          <div className="fdt-add-wrap">
            <select
              className="fdt-add-select"
              value=""
              onChange={e => { if (e.target.value) onAdd(e.target.value) }}
            >
              <option value="">+ Ajouter un appareil…</option>
              {addable.map(d => (
                <option key={d._id} value={d._id}>
                  {[d.deviceType || 'DAE', d.serialNumber, d.location].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
            <Plus size={13} className="fdt-add-icon" />
          </div>
        )}
      </div>

      <div className="fdt-list">
        {entries.map(entry => {
          const pct  = ficheProgress(entry)
          const on   = entry.key === activeKey
          const full = pct === 100
          return (
            <button
              key={entry.key}
              type="button"
              className={`fdt-card${on ? ' fdt-card--on' : ''}${full ? ' fdt-card--done' : ''}`}
              onClick={() => onSelect(entry.key)}
            >
              <span className="fdt-card-icon">
                {full ? <Check size={14} /> : <Zap size={14} />}
              </span>
              <span className="fdt-card-main">
                <span className="fdt-card-name">
                  {entry.deaLabel || deaLabel(entry)}
                </span>
                <span className="fdt-card-sub">
                  {entry.emplacement
                    ? <><MapPin size={10} /> {entry.emplacement}</>
                    : entry.serialNumber || 'à renseigner'}
                </span>
                <span className="fdt-card-bar">
                  <span className="fdt-card-fill" style={{ width: `${pct}%` }} />
                </span>
              </span>
              {!readOnly && entries.length > 1 && (
                <span
                  className="fdt-card-del"
                  role="button"
                  tabIndex={-1}
                  title="Retirer cet appareil de la visite"
                  onClick={e => { e.stopPropagation(); onRemove(entry.key) }}
                >
                  <Trash2 size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
