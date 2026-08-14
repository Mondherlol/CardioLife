import { useState, useEffect } from 'react'
import {
  X, AlertTriangle, CalendarClock, HeartPulse, Package, Check, Building2,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { getProductItems } from '../api/productItems'
import { createInstallation } from '../api/installations'
import { getUsers } from '../api/users'
import { getSites } from '../api/sites'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

const DEA_CATEGORY = 'defibrillateurs'

/**
 * Planification d'une pose chez un client.
 *
 * Le matériel réservé pour ce client est proposé d'emblée : c'est lui qu'on
 * vient poser. Chaque défibrillateur retenu devient une pose distincte — un
 * client peut en faire installer plusieurs le même jour sur le même site — et
 * les autres articles (armoire, signalétique…) sont livrés avec.
 *
 * Props :
 *  clientId - client concerné
 *  sites    - sites du client
 *  site     - site pré-sélectionné (optionnel)
 *  onClose  - () => void
 *  onDone   - () => void
 */
export default function InstallationPlanModal({ clientId, sites = [], site: preset, onClose, onDone }) {
  const [siteId, setSiteId]   = useState(preset?._id || (sites.length === 1 ? sites[0]._id : ''))
  const [items,  setItems]    = useState([])
  const [picked, setPicked]   = useState([])       // ids des articles retenus
  const [techs,  setTechs]    = useState([])
  const [form,   setForm]     = useState({ date: '', technicien: '', location: '', notes: '' })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [siteList, setSiteList] = useState(sites)

  useEffect(() => {
    getUsers({ role: 'technicien' })
      .then(d => setTechs(Array.isArray(d) ? d : (d?.data || [])))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (sites.length) return
    getSites({ client: clientId })
      .then(l => setSiteList(Array.isArray(l) ? l : []))
      .catch(() => {})
  }, [clientId, sites.length])

  /* Le matériel déjà promis à ce client : c'est ce qu'on vient poser. */
  useEffect(() => {
    setLoading(true)
    getProductItems({ client: clientId, status: 'reserve' })
      .then(res => setItems(Array.isArray(res.data) ? res.data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [clientId])

  const forSite = items.filter(it => {
    const s = it.reservedFor?.site?._id || it.reservedFor?.site || it.site?._id || it.site
    return !siteId || !s || String(s) === String(siteId)
  })
  const deas   = forSite.filter(it => it.category === DEA_CATEGORY)
  const others = forSite.filter(it => it.category !== DEA_CATEGORY)

  const pickedDeas   = deas.filter(it => picked.includes(it._id))
  const pickedOthers = others.filter(it => picked.includes(it._id))

  function toggle(id) {
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!siteId)    { setError('Choisissez le site où poser le matériel.'); return }
    if (!form.date) { setError('Indiquez la date d\'installation.'); return }
    if (pickedDeas.length === 0) {
      setError('Choisissez au moins un défibrillateur à installer.')
      return
    }

    const tech = techs.find(t => t._id === form.technicien)

    setSaving(true)
    try {
      /* Une pose par défibrillateur : chacun a son emplacement, son numéro de
         série et son propre suivi de contrôle. Les autres articles accompagnent
         la première pose, celle qui amène le technicien sur place. */
      for (const [i, item] of pickedDeas.entries()) {
        await createInstallation({
          client:        clientId,
          site:          siteId,
          status:        'a_installer',
          scheduledDate: form.date,
          technician:     form.technicien || undefined,
          technicianName: tech ? (tech.fullName || tech.username) : undefined,
          deviceProduct: item.product?._id || item.product,
          deviceType:    item.product?.name || '',
          serialNumber:  item.serialNumber || '',
          location:      form.location,
          notes: [
            form.notes,
            i === 0 && pickedOthers.length
              ? `À livrer : ${pickedOthers.map(o => o.product?.name || o.reference || o.serialNumber).join(', ')}`
              : '',
          ].filter(Boolean).join('\n'),
        })
      }

      toast.success(pickedDeas.length > 1
        ? `${pickedDeas.length} installations planifiées.`
        : 'Installation planifiée.')
      onDone?.()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const ItemRow = ({ it, icon: Icon }) => {
    const on = picked.includes(it._id)
    return (
      <button type="button" key={it._id}
        className={`inst-pick${on ? ' inst-pick--on' : ''}`}
        onClick={() => toggle(it._id)}>
        <span className="inst-pick-check">{on && <Check size={12} />}</span>
        <Icon size={14} className="inst-pick-icon" />
        <span className="inst-pick-main">
          <span className="inst-pick-name">{it.product?.name || 'Article'}</span>
          <span className="inst-pick-sub">
            {it.serialNumber || it.lotNumber || 'sans numéro'}
            {it.reservedFor?.site?.name && <> · {it.reservedFor.site.name}</>}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><CalendarClock size={16} /> Planifier une installation</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label">Site <span style={{ color: 'var(--red-500)' }}>*</span></label>
            <select className="form-input form-input--plain" value={siteId}
              onChange={e => setSiteId(e.target.value)}>
              <option value="">— Choisir le site —</option>
              {siteList.map(s => (
                <option key={s._id} value={s._id}>
                  {s.name}{s.address?.city ? ` · ${s.address.city}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="form-section-title" style={{ marginTop: 4 }}>
            Matériel réservé pour ce client
          </div>

          {loading ? (
            <div className="table-loading"><span className="spinner" /></div>
          ) : forSite.length === 0 ? (
            <p className="cd-empty-hint">
              Aucun matériel réservé pour ce client. Réservez-le depuis le stock,
              en précisant le site, puis revenez ici.
            </p>
          ) : (
            <>
              {deas.length > 0 && (
                <>
                  <span className="form-label-opt">Défibrillateurs à poser</span>
                  <div className="inst-pick-list">
                    {deas.map(it => <ItemRow key={it._id} it={it} icon={HeartPulse} />)}
                  </div>
                </>
              )}
              {others.length > 0 && (
                <>
                  <span className="form-label-opt">Autres articles à livrer</span>
                  <div className="inst-pick-list">
                    {others.map(it => <ItemRow key={it._id} it={it} icon={Package} />)}
                  </div>
                </>
              )}
            </>
          )}

          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label">Date d'installation <span style={{ color: 'var(--red-500)' }}>*</span></label>
              <input type="date" className="form-input form-input--plain"
                value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Technicien</label>
              <select className="form-input form-input--plain" value={form.technicien}
                onChange={e => set('technicien', e.target.value)}>
                <option value="">— Non assigné —</option>
                {techs.map(t => (
                  <option key={t._id} value={t._id}>{t.fullName || t.username}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Emplacement prévu <span className="form-label-opt">(le technicien pourra le préciser)</span>
            </label>
            <input className="form-input form-input--plain" value={form.location}
              onChange={e => set('location', e.target.value)}
              placeholder="Ex : Hall d'accueil, 2e étage" />
          </div>

          <div className="form-group">
            <label className="form-label">Consignes pour le technicien</label>
            <textarea className="form-input form-input--plain form-textarea" rows={2}
              value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Accès, contact sur place, particularités…" />
          </div>

          {pickedDeas.length > 1 && (
            <p className="form-hint">
              <Building2 size={11} /> {pickedDeas.length} poses seront créées pour cette date —
              une par appareil, chacune avec son propre suivi.
            </p>
          )}

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <span className="login-btn-spinner" /> : 'Planifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
