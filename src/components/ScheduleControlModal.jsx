import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import {
  X, CalendarCheck, Building2, Calendar, Clock, User, ChevronDown, AlertTriangle, Info, Plus,
} from 'lucide-react'
import { updateIntervention } from '../api/interventions'
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
export default function ScheduleControlModal({ presetDate, presetType, onClose, onDone, onHorsContrat }) {
  const [client,   setClient]   = useState({ id: null, name: '' })
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
      .then(list => { if (alive) setControls(list) })
      .catch(() => { if (alive) setControls([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [client.id])

  // Les périodiques d'abord : ce sont eux qu'on vient caler.
  const shown = controls
    .filter(c => !presetType || c.controlType === presetType || !PERIODIC_TYPES.includes(c.controlType))
    .sort((a, b) => PERIODIC_TYPES.includes(b.controlType) - PERIODIC_TYPES.includes(a.controlType)
      || new Date(a.scheduledDate) - new Date(b.scheduledDate))

  function pick(c) {
    setPicked(c)
    // Le technicien déjà assigné reste proposé.
    setTech(String(c.technicien?._id || c.technicien || ''))
    // On part de la date où le contrôle est prévu ; le jour cliqué reste
    // proposé en un clic, sous le champ date.
    setDate(localDateStr(c.scheduledDate))
    setTime(localTimeStr(c.scheduledDate))
  }

  const slotDiffers = picked && slot && slot.day !== localDateStr(picked.scheduledDate)

  async function handleSave() {
    setError('')
    if (!picked) return setError('Choisissez le contrôle à programmer.')
    if (!date)   return setError('Indiquez la date.')
    const t = techs.find(u => String(u._id) === String(tech))
    const when = joinDateTime(date, time)
    setSaving(true)
    try {
      await updateIntervention(picked._id, {
        scheduledDate:  when,
        technicien:     t?._id || null,
        technicienName: t ? (t.fullName || t.username) : '',
      })
      toast.success(`${CONTROL_LABELS[picked.controlType] || 'Contrôle'} programmé le ${fmtDay(when)}.`)
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
      <div className="modal modal--md modal--dropdown">
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
                    <AlertTriangle size={11} /> Aucun contrôle prévu pour ce client
                    {presetType ? ` (${CONTROL_LABELS[presetType].toLowerCase()})` : ''} — pas de contrat actif ?
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
                        {isToSchedule(c) && <span className="sc-badge">Sans technicien</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><Calendar size={12} /> Date *</label>
              <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
              {slotDiffers && date !== slot.day && (
                <button type="button" className="sc-slot-btn"
                  onClick={() => { setDate(slot.day); if (slot.time) setTime(slot.time) }}>
                  Déplacer au {fmtDay(slot.day + 'T12:00')} (jour cliqué)
                </button>
              )}
            </div>
            <div className="form-group">
              <label className="form-label"><Clock size={12} /> Heure</label>
              <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label"><User size={12} /> Technicien</label>
            <div className="fiche-select-wrap">
              <select className="form-input" value={tech} onChange={e => setTech(e.target.value)}>
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
