import { useState, useEffect } from 'react'
import { GraduationCap, ChevronDown } from 'lucide-react'
import { getFormationsBySite } from '../api/formations'
import { setFormationLink } from '../api/interventions'

export const DEFAULT_FORMATION_TITLE = "Formation à l'utilisation du défibrillateur"

export const emptyFormationLink = () => ({
  enabled: false, mode: 'new', title: DEFAULT_FORMATION_TITLE, participantsCount: '', formationId: '',
})

const STATUS = { planifie: 'Programmée', en_cours: 'En cours', fait: 'Réalisée', annule: 'Annulée' }

/**
 * « Avec formation des agents » : une séance nouvelle, le jour de la visite,
 * ou une séance existante du site — même ancienne.
 *
 * Partagé par la programmation d'un contrôle et la création d'une
 * intervention ; l'onglet Formation de la fiche le réutilise (`alwaysOn`).
 */
export default function FormationLinkFields({ siteId, value, onChange, alwaysOn = false, noSiteHint = "Choisissez d'abord le site." }) {
  const [options, setOptions] = useState([])
  const set = patch => onChange({ ...value, ...patch })
  const on  = alwaysOn || value.enabled

  useEffect(() => {
    if (!siteId || !on || value.mode !== 'existing') return
    let alive = true
    getFormationsBySite(siteId)
      .then(list => { if (alive) setOptions(Array.isArray(list) ? list : []) })
      .catch(() => { if (alive) setOptions([]) })
    return () => { alive = false }
  }, [siteId, on, value.mode])

  return (
    <div className="fl-box">
      {!alwaysOn && (
        <label className="sp-reset-opt">
          <input type="checkbox" checked={value.enabled} onChange={e => set({ enabled: e.target.checked })} />
          <span><GraduationCap size={13} style={{ verticalAlign: -2 }} /> Avec formation des agents</span>
        </label>
      )}

      {on && (
        <div className="fl-body">
          <div className="ct-type-choice">
            {[['new', 'Nouvelle formation'], ['existing', 'Formation existante']].map(([m, label]) => (
              <label key={m} className={`bi-nature${value.mode === m ? ' bi-nature--on' : ''}`}>
                <input type="radio" checked={value.mode === m} onChange={() => set({ mode: m })} />
                {label}
              </label>
            ))}
          </div>

          {value.mode === 'new' ? (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Intitulé</label>
                <input className="form-input" value={value.title} onChange={e => set({ title: e.target.value })} />
              </div>
              <div className="form-group" style={{ maxWidth: 160 }}>
                <label className="form-label">Agents à former</label>
                <input className="form-input" type="number" min="0" value={value.participantsCount}
                  onChange={e => set({ participantsCount: e.target.value })} placeholder="ex. 12" />
              </div>
            </div>
          ) : !siteId ? (
            <p className="form-hint">{noSiteHint}</p>
          ) : options.length === 0 ? (
            <p className="form-hint">Aucune formation enregistrée pour ce site.</p>
          ) : (
            <div className="fiche-select-wrap">
              <select className="form-input" value={value.formationId} onChange={e => set({ formationId: e.target.value })}>
                <option value="">— Choisir une formation —</option>
                {options.map(f => (
                  <option key={f._id} value={f._id}>
                    {new Date(f.date).toLocaleDateString('fr-FR')} · {f.title} · {STATUS[f.status] || f.status}
                    {f.intervention ? ' · déjà liée à une visite' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="fiche-select-chevron" />
            </div>
          )}
          <p className="form-hint">
            La formation apparaît dans le tableau des formations et dans l'onglet « Formation » de la visite.
          </p>
        </div>
      )}
    </div>
  )
}

/** Valide les champs : renvoie un message d'erreur, ou rien. */
export function formationLinkError(value, alwaysOn = false) {
  if (!alwaysOn && !value.enabled) return ''
  if (value.mode === 'existing' && !value.formationId) return 'Choisissez la formation à lier.'
  return ''
}

/** Crée ou lie la formation de la visite, selon les champs. Rien si non cochés. */
export async function applyFormationLink(interventionId, value, alwaysOn = false) {
  if (!alwaysOn && !value.enabled) return null
  return value.mode === 'existing'
    ? setFormationLink(interventionId, { mode: 'existing', formationId: value.formationId })
    : setFormationLink(interventionId, {
        mode: 'new', title: value.title, participantsCount: Number(value.participantsCount) || 0,
      })
}
