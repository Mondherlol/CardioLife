import { useState, useEffect } from 'react'
import {
  Plus, X, Zap, ChevronDown, Building2, MapPin, User, Calendar,
  StickyNote, AlertTriangle, Info, HeartPulse,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { createIntervention } from '../api/interventions'
import { lookupSites } from '../api/sites'
import { get } from '../api/http'
import { ClientSearchInput } from './PlanningInputs'
import { localDateStr } from '../lib/appointmentConstants'

/**
 * Programmation d'un contrôle hors calendrier de contrat.
 *
 * Partagée par la page Contrôles et le planning : c'est le même geste, il ne
 * doit pas exister en deux versions qui divergent.
 *
 * La visite se compose comme on la vit : on choisit le client, puis le site où
 * se rendre, puis — si besoin — l'appareil précis. Sans appareil désigné, le
 * contrôle porte sur tout le parc du site et le technicien remplit une fiche
 * par DAE.
 *
 * Le type est toujours « hors contrat » : les contrôles semestriels et annuels
 * naissent du contrat du site, jamais d'une saisie manuelle.
 *
 * Props :
 *  presetDate - date planifiée pré-remplie (créneau choisi dans le planning)
 *  onClose    - () => void
 *  onCreated  - (controle) => void
 */
export default function ControlCreateModal({ presetDate, onClose, onCreated }) {
  const [techniciens, setTechniciens] = useState([])
  const [sites,       setSites]       = useState([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const [form, setForm] = useState({
    clientId:       null,
    clientName:     '',
    siteId:         '',
    installation:   '',      // DAE précis, vide = tout le site
    technicien:     '',
    technicienName: '',
    scheduledDate:  presetDate ? localDateStr(presetDate) : '',
    notes:          '',
  })

  useEffect(() => {
    get('/users?role=technicien&limit=100')
      .then(res => setTechniciens(res.data || res))
      .catch(() => {})
  }, [])

  /* Les sites du client, avec leur parc : c'est là que se choisit la visite. */
  useEffect(() => {
    if (!form.clientId) { setSites([]); return }
    let alive = true
    setLoadingSites(true)
    lookupSites(form.clientId)
      .then(d => { if (alive) setSites(Array.isArray(d) ? d : []) })
      .catch(() => { if (alive) setSites([]) })
      .finally(() => { if (alive) setLoadingSites(false) })
    return () => { alive = false }
  }, [form.clientId])

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })) }

  const site = sites.find(s => String(s._id) === String(form.siteId)) || null
  const deas = site?.deas || []
  const dea  = deas.find(d => String(d._id) === String(form.installation)) || null

  // Un site unique n'appelle pas de choix : on le retient d'office.
  useEffect(() => {
    if (!form.siteId && sites.length === 1) setF('siteId', sites[0]._id)
  }, [sites]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickClient(sel) {
    setForm(p => ({
      ...p,
      clientId:   sel ? sel.id : null,
      clientName: sel ? sel.name : '',
      siteId:     '',
      installation: '',
    }))
  }

  function selectTechnicien(e) {
    const t = techniciens.find(u => u._id === e.target.value)
    setForm(p => ({
      ...p,
      technicien:     t?._id || '',
      technicienName: t?.fullName || t?.username || '',
    }))
  }

  const siteAddress = s => [s.address?.street, s.address?.city].filter(Boolean).join(', ')

  async function handleCreate() {
    setError('')
    if (!form.clientId)      return setError('Choisissez le client concerné.')
    if (!form.siteId)        return setError('Choisissez le site à visiter.')
    if (!form.scheduledDate) return setError('Indiquez la date planifiée.')

    setSaving(true)
    try {
      const created = await createIntervention({
        client:     form.clientId,
        clientName: form.clientName,
        site:       form.siteId,
        siteName:   site?.name || '',
        installation: form.installation || undefined,
        // Le snapshot fige ce que le technicien verra sur sa liste, même si le
        // parc change entre la programmation et la visite.
        installationSnap: {
          deviceType:   dea?.deviceType   || '',
          serialNumber: dea?.serialNumber || '',
          address:      site ? [site.name, siteAddress(site)].filter(Boolean).join(' — ') : '',
          location:     dea?.location     || '',
        },
        technicien:     form.technicien || undefined,
        technicienName: form.technicienName,
        scheduledDate:  form.scheduledDate,
        controlType:    'hors_contrat',
        notes:          form.notes,
      })
      toast.success('Contrôle programmé.')
      onCreated(created)
      onClose()
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md modal--dropdown">
        <div className="modal-header">
          <h2 className="modal-title">
            <Plus size={16} /> Nouveau contrôle
          </h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {/* Le type ne se choisit pas : c'est le contrat qui cadence les
              contrôles périodiques. */}
          <div className="ctrl-create-note">
            <Info size={13} />
            <span>
              Contrôle <strong>hors contrat</strong>. Les visites semestrielles et
              annuelles sont générées automatiquement par le contrat du site.
            </span>
          </div>

          {/* Étape 1 — le client */}
          <div className="form-group">
            <label className="form-label"><Building2 size={12} /> Client *</label>
            <ClientSearchInput
              clientId={form.clientId}
              clientName={form.clientName}
              onChange={pickClient}
            />
          </div>

          {/* Étape 2 — le site */}
          <div className="form-group">
            <label className="form-label"><MapPin size={12} /> Site à visiter *</label>
            {!form.clientId ? (
              <p className="form-hint">Choisissez d'abord un client.</p>
            ) : loadingSites ? (
              <div className="table-loading" style={{ padding: 12 }}><span className="spinner" /></div>
            ) : sites.length === 0 ? (
              <p className="form-hint">
                <AlertTriangle size={11} /> Aucun site actif pour ce client.
              </p>
            ) : (
              <div className="ctrl-site-list">
                {sites.map(s => {
                  const on = String(s._id) === String(form.siteId)
                  const n  = s.deas?.length || 0
                  return (
                    <button key={s._id} type="button"
                      className={`ctrl-site${on ? ' ctrl-site--on' : ''}`}
                      onClick={() => setForm(p => ({ ...p, siteId: s._id, installation: '' }))}>
                      <span className="ctrl-site-main">
                        <span className="ctrl-site-name">{s.name}</span>
                        {siteAddress(s) && <span className="ctrl-site-addr">{siteAddress(s)}</span>}
                      </span>
                      <span className={`ctrl-site-count${n === 0 ? ' ctrl-site-count--empty' : ''}`}>
                        <HeartPulse size={11} /> {n} DAE
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Étape 3 — l'appareil, facultatif */}
          {site && (
            <div className="form-group">
              <label className="form-label">
                <Zap size={12} /> Appareil <span className="form-label-opt">(facultatif)</span>
              </label>
              <div className="fiche-select-wrap">
                <select
                  className="form-input"
                  value={form.installation}
                  onChange={e => setF('installation', e.target.value)}
                >
                  <option value="">Tout le site — une fiche par DAE</option>
                  {/* `value` explicite, jamais `undefined` : sinon le select
                      devient non contrôlé et soumet le libellé de l'option. */}
                  {deas.filter(d => d._id).map(d => (
                    <option key={d._id} value={String(d._id)}>
                      {[d.deviceType || 'DAE', d.serialNumber, d.location].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="fiche-select-chevron" />
              </div>
              <p className="form-hint">
                {form.installation
                  ? 'Le contrôle ne portera que sur cet appareil.'
                  : `Le technicien contrôlera les ${deas.length} appareil${deas.length > 1 ? 's' : ''} du site.`}
              </p>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label"><Calendar size={12} /> Date planifiée *</label>
              <input
                type="date"
                className="form-input"
                value={form.scheduledDate}
                onChange={e => setF('scheduledDate', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label"><User size={12} /> Technicien assigné</label>
              <div className="fiche-select-wrap">
                <select className="form-input" value={form.technicien} onChange={selectTechnicien}>
                  <option value="">— Non assigné —</option>
                  {techniciens.map(t => (
                    <option key={t._id} value={t._id}>{t.fullName || t.username}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="fiche-select-chevron" />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label"><StickyNote size={12} /> Notes</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Instructions pour le technicien…"
              value={form.notes}
              onChange={e => setF('notes', e.target.value)}
            />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={handleCreate} disabled={saving}>
            {saving && <span className="spinner spinner--sm" />}
            <Plus size={14} /> Programmer
          </button>
        </div>
      </div>
    </div>
  )
}
