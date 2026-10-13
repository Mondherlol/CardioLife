import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import {
  X, CalendarCheck, Building2, Calendar, Clock, User, ChevronDown, AlertTriangle, Info, Plus, Type, GraduationCap,
} from 'lucide-react'
import { updateIntervention, setControlType } from '../api/interventions'
import { useFollowingControls, RealignPreview } from './ControlAdminModals'
import FormationLinkFields, { emptyFormationLink, formationLinkError, applyFormationLink } from './FormationLinkFields'
import { get } from '../api/http'
import { ClientSearchInput } from './PlanningInputs'
import { localDateStr, localTimeStr } from '../lib/appointmentConstants'
import {
  pendingControlsOf, isToSchedule, CONTROL_LABELS, PERIODIC_TYPES, joinDateTime, fmtDay,
} from '../lib/scheduledControls'

/**
 * Programmer un contrôle déjà prévu.
 *
 * Les contrôles semestriels et annuels existent avant qu'on les programme :
 * le contrat les génère à une date théorique. Programmer, c'est donc caler
 * celui-là — date réelle et technicien —, jamais en créer un second. Faute de
 * ce geste, l'équipe créait des interventions nommées « contrôle annuel » :
 * des doublons qui ne mettaient pas à jour l'échéance du site.
 *
 * Un client sans contrôle prévu (pas de contrat) se rabat sur le contrôle hors
 * contrat, via `onHorsContrat`.
 *
 * Props :
 *  presetDate    - date (ISO) du créneau cliqué dans le planning
 *  presetType    - 'semestriel' | 'annuel' : pré-filtre la liste
 *  onClose, onDone
 *  onHorsContrat - (date) => void : ouvre la création d'un contrôle hors contrat
 */
export default function ScheduleControlModal({ presetDate, presetType, presetControl, presetTitle, onClose, onDone, onHorsContrat }) {
  // Ouvert depuis un contrôle précis (liste des contrôles en attente) : client
  // et contrôle sont déjà choisis.
  const [client,   setClient]   = useState(presetControl
    ? { id: presetControl.client?._id || presetControl.client, name: presetControl.clientName || presetControl.client?.name || '' }
    : { id: null, name: '' })
  const [controls, setControls] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [picked,   setPicked]   = useState(null)
  const [techs,    setTechs]    = useState([])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  /* Une case de la vue mois arrive en « 2026-10-14 », sans heure : lue comme
     une date ISO, elle tombait à minuit UTC — 01:00 à Tunis. On n'en garde
     donc que le jour, et l'heure seulement quand le créneau en porte une. */
  const slot = !presetDate ? null
    : (typeof presetDate === 'string' && !presetDate.includes('T'))
      ? { day: presetDate.slice(0, 10), time: null }
      : { day: localDateStr(presetDate), time: localTimeStr(presetDate) }
  const [date, setDate] = useState(slot?.day || '')
  const [time, setTime] = useState(slot?.time || '09:00')
  const [tech, setTech] = useState('')
  /* Titre du contrôle (« Contrôle + formation des nouveaux agents ») : saisi
     dans la fenêtre du planning, il suit jusqu'ici, puis sur la fiche du
     contrôle et sur son bon. */
  const [title, setTitle] = useState(presetTitle || '')
  /* Type de la visite : celui du contrôle choisi, corrigeable — « là c'est
     l'annuel, il y a eu un semestriel entre-temps ». La suite du site peut
     reprendre l'alternance à partir de lui. */
  const [visitType, setVisitType] = useState(null)
  const [realign,   setRealign]   = useState(true)
  // Formation des agents qui accompagne la visite (nouvelle ou existante).
  const [fLink,     setFLink]     = useState(emptyFormationLink)

  useEffect(() => {
    get('/users?role=technicien&limit=100')
      .then(res => setTechs(res.data || res))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPicked(null)
    if (!client.id) { setControls([]); return }
    let alive = true
    setLoading(true)
    pendingControlsOf(client.id)
      .then(list => {
        if (!alive) return
        setControls(list)
        const preset = presetControl && list.find(c => c._id === presetControl._id)
        if (preset) pick(preset)
      })
      .catch(() => { if (alive) setControls([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [client.id])

  /* Tous les contrôles restant dus, du plus ancien au plus lointain. On ne
     filtre plus sur le type choisi dans le planning : choisir « annuel »
     masquait le semestriel en retard du même site, et on calait l'annuel
     d'avril à sa place — deux visites dues au lieu d'une. Le type d'une visite
     découle du contrat (alternance), pas de ce qu'on coche. */
  const shown = [...controls]
    .sort((a, b) => PERIODIC_TYPES.includes(b.controlType) - PERIODIC_TYPES.includes(a.controlType)
      || new Date(a.scheduledDate) - new Date(b.scheduledDate))

  // Le contrôle dû en premier sur chaque site : c'est lui qu'on programme.
  const siteKey = c => String(c.site?._id || c.site || '')
  const firstDue = {}
  for (const c of shown) {
    if (PERIODIC_TYPES.includes(c.controlType) && !firstDue[siteKey(c)]) firstDue[siteKey(c)] = c
  }
  const isFirstDue = c => firstDue[siteKey(c)]?._id === c._id
  // Contrôle choisi alors qu'un autre, plus ancien, reste dû sur le même site.
  const earlier = picked && PERIODIC_TYPES.includes(picked.controlType) && !isFirstDue(picked)
    ? firstDue[siteKey(picked)]
    : null

  function pick(c) {
    setPicked(c)
    // Le technicien déjà assigné reste proposé.
    setTech(String(c.technicien?._id || c.technicien || ''))
    // On part de la date où le contrôle est prévu ; le jour cliqué reste
    // proposé en un clic, sous le champ date.
    setDate(localDateStr(c.scheduledDate))
    setTime(localTimeStr(c.scheduledDate))
    // Un titre déjà donné au contrôle est repris, sauf si on vient d'en saisir un.
    if (!presetTitle) setTitle(c.objet || '')
    setVisitType(c.controlType)
  }

  const typeChanged = picked && PERIODIC_TYPES.includes(picked.controlType)
    && visitType && visitType !== picked.controlType
  const following = useFollowingControls(typeChanged ? picked : null)

  const slotDiffers = picked && slot && slot.day !== localDateStr(picked.scheduledDate)

  async function handleSave() {
    setError('')
    if (!picked) return setError('Choisissez le contrôle à programmer.')
    if (!date)   return setError('Indiquez la date.')
    const flErr = formationLinkError(fLink)
    if (flErr) return setError(flErr)
    const t = techs.find(u => String(u._id) === String(tech))
    const when = joinDateTime(date, time)
    setSaving(true)
    try {
      if (typeChanged) await setControlType(picked._id, visitType, realign)
      await updateIntervention(picked._id, {
        scheduledDate:  when,
        technicien:     t?._id || null,
        technicienName: t ? (t.fullName || t.username) : '',
        objet:          title.trim(),
      })
      // Après la date : une séance nouvelle se cale sur le jour de la visite.
      await applyFormationLink(picked._id, fLink)
      toast.success(`${CONTROL_LABELS[typeChanged ? visitType : picked.controlType] || 'Contrôle'} programmé le ${fmtDay(when)}.`)
      onDone()
    } catch (err) {
      setError(err.message || 'Programmation impossible.')
    } finally {
      setSaving(false)
    }
  }

  const horsContrat = () => onHorsContrat(date ? joinDateTime(date, time) : null)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><CalendarCheck size={16} /> Programmer un contrôle</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="ctrl-create-note">
            <Info size={13} />
            <span>
              Les contrôles <strong>semestriels et annuels</strong> sont déjà prévus par le contrat.
              Choisissez celui à caler : il est <strong>déplacé</strong> à la date voulue, rien n'est créé en double.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label"><Building2 size={12} /> Client *</label>
            <ClientSearchInput
              clientId={client.id}
              clientName={client.name}
              onChange={sel => setClient(sel ? { id: sel.id, name: sel.name } : { id: null, name: '' })}
            />
          </div>

          {client.id && (
            <div className="form-group">
              <label className="form-label"><CalendarCheck size={12} /> Contrôle prévu *</label>
              {loading ? (
                <div className="table-loading" style={{ padding: 12 }}><span className="spinner" /></div>
              ) : shown.length === 0 ? (
                <div className="sc-empty">
                  <p className="form-hint">
                    <AlertTriangle size={11} /> Aucun contrôle prévu pour ce client — pas de contrat actif ?
                  </p>
                  {onHorsContrat && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={horsContrat}>
                      <Plus size={13} /> Programmer un contrôle hors contrat
                    </button>
                  )}
                </div>
              ) : (
                <div className="ctrl-site-list">
                  {shown.map(c => {
                    const on = picked?._id === c._id
                    return (
                      <button key={c._id} type="button"
                        className={`ctrl-site${on ? ' ctrl-site--on' : ''}`}
                        onClick={() => pick(c)}>
                        <span className="ctrl-site-main">
                          <span className="ctrl-site-name">
                            {CONTROL_LABELS[c.controlType] || 'Contrôle'}{c.siteName ? ` — ${c.siteName}` : ''}
                          </span>
                          <span className="ctrl-site-addr">
                            Prévu le {fmtDay(c.scheduledDate)} à {localTimeStr(c.scheduledDate)}
                            {c.technicienName ? ` · ${c.technicienName}` : ''}
                          </span>
                        </span>
                        {c.enAttente
                          ? <span className="sc-badge sc-badge--wait">En attente de RDV</span>
                          : isFirstDue(c)
                            ? <span className="sc-badge sc-badge--due">Prochain dû</span>
                            : isToSchedule(c) && <span className="sc-badge">Sans technicien</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {earlier && (
            <div className="cc-dup-warn">
              <AlertTriangle size={14} />
              <div>
                <p>
                  Ce site a encore un <strong>{CONTROL_LABELS[earlier.controlType].toLowerCase()}</strong> dû
                  le <strong>{fmtDay(earlier.scheduledDate)}</strong>, avant celui-ci. Programmer ce
                  {' '}{CONTROL_LABELS[picked.controlType].toLowerCase()} laisserait l'autre en retard :
                  le site aurait deux visites à faire au lieu d'une.
                </p>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => {
                  // On garde la date et le technicien déjà choisis : seul le contrôle change.
                  const keep = { date, time, tech }
                  pick(earlier)
                  setDate(keep.date); setTime(keep.time); setTech(keep.tech)
                }}>
                  Programmer plutôt le {CONTROL_LABELS[earlier.controlType].toLowerCase()} du {fmtDay(earlier.scheduledDate)}
                </button>
              </div>
            </div>
          )}

          {picked && PERIODIC_TYPES.includes(picked.controlType) && (
            <div className="form-group">
              <label className="form-label">Type de la visite</label>
              <div className="ct-type-choice">
                {PERIODIC_TYPES.map(t => (
                  <label key={t} className={`bi-nature${visitType === t ? ' bi-nature--on' : ''}`}>
                    <input type="radio" name="sc-type" checked={visitType === t} onChange={() => setVisitType(t)} />
                    {CONTROL_LABELS[t]}
                  </label>
                ))}
              </div>
              {typeChanged && (
                <>
                  <label className="sp-reset-opt" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={realign} onChange={e => setRealign(e.target.checked)} />
                    <span>Réaligner les contrôles suivants du site</span>
                  </label>
                  {realign && <RealignPreview following={following} newType={visitType} />}
                </>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label"><Type size={12} /> Titre <span className="form-label-opt">(facultatif)</span></label>
            <input className="form-input form-input--plain" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="ex. Contrôle + formation des nouveaux agents" />
          </div>

          {/* Toujours proposé : on coche « avec formation » avant même d'avoir
              choisi le contrôle. Une formation existante se choisit une fois le
              contrôle (donc le site) connu. */}
          {picked?.formation?.formation
            ? <p className="form-hint">
                <GraduationCap size={11} /> Une formation accompagne déjà ce contrôle
                {picked.formation.titre ? ` (${picked.formation.titre})` : ''} — elle se gère dans l'onglet Formation de sa fiche.
              </p>
            : <FormationLinkFields siteId={picked?.site?._id || picked?.site} value={fLink} onChange={setFLink}
                noSiteHint="Choisissez d'abord le client et le contrôle à programmer." />}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><Calendar size={12} /> Date *</label>
              <input type="date" className="form-input form-input--plain" value={date} onChange={e => setDate(e.target.value)} />
              {slotDiffers && date !== slot.day && (
                <button type="button" className="sc-slot-btn"
                  onClick={() => { setDate(slot.day); if (slot.time) setTime(slot.time) }}>
                  Déplacer au {fmtDay(slot.day + 'T12:00')} (jour cliqué)
                </button>
              )}
            </div>
            <div className="form-group">
              <label className="form-label"><Clock size={12} /> Heure</label>
              <input type="time" className="form-input form-input--plain" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label"><User size={12} /> Technicien</label>
            <div className="fiche-select-wrap">
              <select className="form-input form-input--plain" value={tech} onChange={e => setTech(e.target.value)}>
                <option value="">— Non assigné —</option>
                {techs.map(t => <option key={t._id} value={t._id}>{t.fullName || t.username}</option>)}
              </select>
              <ChevronDown size={13} className="fiche-select-chevron" />
            </div>
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
        </div>

        <div className="modal-footer">
          {onHorsContrat && client.id && shown.length > 0 && (
            <button type="button" className="btn btn--ghost" style={{ marginRight: 'auto' }} onClick={horsContrat}>
              Contrôle hors contrat…
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving || !picked}>
            {saving && <span className="spinner spinner--sm" />}
            <CalendarCheck size={14} /> Programmer
          </button>
        </div>
      </div>
    </div>
  )
}
