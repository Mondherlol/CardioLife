import { useState, useEffect, useMemo, useRef } from 'react'
import {
  X, AlertTriangle, CalendarClock, HeartPulse, Package, Check, Building2, Plus, Search, Clock,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { getProductItems } from '../api/productItems'
import { getInstallations, planInstallation } from '../api/installations'
import { getUsers } from '../api/users'
import { getSites } from '../api/sites'
import { getClient } from '../api/clients'
import { ClientSearchInput } from './PlanningInputs'
import FormationLinkFields, { emptyFormationLink, formationLinkError, applyFormationLink } from './FormationLinkFields'
import { localDateStr, localTimeStr } from '../lib/appointmentConstants'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

const DEA_CATEGORY = 'defibrillateurs'
const NEW_SITE = '__new__'

const categoryOf = it => it.category || it.product?.category || ''
const isDea      = it => categoryOf(it) === DEA_CATEGORY
const siteOfItem = it => String(it.reservedFor?.site?._id || it.reservedFor?.site || it.site?._id || it.site || '')

/**
 * Programmer une installation chez un client.
 *
 * Une installation est une visite : elle passe au planning, le technicien la
 * démarre, remplit une fiche par appareil (photos comprises), fait signer le
 * bon et peut former les agents dans la foulée. Sa clôture fait entrer les
 * appareils au parc.
 *
 * Le matériel réservé pour ce client est proposé d'emblée ; à défaut, un
 * appareil disponible du stock se choisit ici et se réserve au passage.
 * Plusieurs DAE posés le même jour sur le même site = une seule visite.
 *
 * Props :
 *  clientId, clientName - client concerné (sinon choisi dans la fenêtre)
 *  sites      - sites du client (optionnel, rechargés sinon)
 *  site       - site pré-sélectionné (optionnel)
 *  presetDate - ISO du créneau choisi dans le planning (optionnel)
 *  presetDeas - DEA déjà prévus à (re)programmer (optionnel)
 *  onClose    - () => void
 *  onDone     - (intervention) => void
 */
export default function InstallationPlanModal({
  clientId: presetClientId, clientName: presetClientName, sites = [], site: preset,
  presetDate, presetDeas = [], onClose, onDone,
}) {
  const [client, setClient] = useState(presetClientId ? { id: presetClientId, name: presetClientName || '' } : null)
  const clientId = client?.id || null

  const [siteList, setSiteList] = useState(sites)
  const [siteId,   setSiteId]   = useState(preset?._id || (sites.length === 1 ? sites[0]._id : ''))
  const [newSite,  setNewSite]  = useState({ name: '', street: '', city: '' })

  const [items,    setItems]    = useState([])     // matériel réservé au client
  const [pending,  setPending]  = useState([])     // DEA déjà prévus, sans visite
  // DEA déclarés « installés » au parc sans être passés par une installation de
  // l'appli : « Ajouter un DEA » consigne par défaut une pose déjà faite.
  const [declared, setDeclared] = useState([])
  const [extra,    setExtra]    = useState([])     // appareils pris au stock ici
  const [picked,   setPicked]   = useState([])     // ids d'articles retenus
  const [pickedDeas, setPickedDeas] = useState(presetDeas.map(d => String(d._id)))

  const [techs,  setTechs]  = useState([])
  const [form,   setForm]   = useState({
    date: presetDate ? localDateStr(presetDate) : '',
    // Case « jour » du calendrier (date seule) : pas d'heure choisie, 9 h par défaut.
    time: presetDate && String(presetDate).length > 10 ? localTimeStr(presetDate) : '09:00',
    technicien: '', location: '', notes: '',
  })
  const [fLink,   setFLink]   = useState(emptyFormationLink())
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const bodyRef = useRef(null)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  useEffect(() => {
    getUsers({ role: 'technicien' })
      .then(d => setTechs(Array.isArray(d) ? d : (d?.data || [])))
      .catch(() => {})
  }, [])

  /* Sites du client. Sans site, la pose en crée un : par défaut au nom et à
     l'adresse du client — un nouveau client n'a souvent encore rien d'autre. */
  useEffect(() => {
    if (!clientId) { setSiteList([]); return }
    if (sites.length && clientId === presetClientId) { setSiteList(sites); return }
    let alive = true
    getSites({ client: clientId })
      .then(l => {
        if (!alive) return
        const list = Array.isArray(l) ? l : []
        setSiteList(list)
        setSiteId(cur => cur && list.some(s => s._id === cur) ? cur
          : list.length === 1 ? list[0]._id
          : list.length === 0 ? NEW_SITE : '')
      })
      .catch(() => {})
    return () => { alive = false }
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clientId || siteId !== NEW_SITE || newSite.name) return
    getClient(clientId)
      .then(c => setNewSite(s => s.name ? s : {
        name: c?.name || client?.name || '', street: c?.address?.street || '', city: c?.address?.city || '',
      }))
      .catch(() => setNewSite(s => s.name ? s : { ...s, name: client?.name || '' }))
  }, [clientId, siteId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Le matériel déjà promis à ce client, et ses poses restées sans visite. */
  useEffect(() => {
    if (!clientId) { setItems([]); setPending([]); return }
    let alive = true
    setLoading(true)
    Promise.all([
      getProductItems({ client: clientId, status: 'reserve' }).catch(() => ({ data: [] })),
      getInstallations({ client: clientId }).catch(() => ({ data: [] })),
    ]).then(([res, inst]) => {
      if (!alive) return
      setItems(Array.isArray(res?.data) ? res.data : [])
      const rows = Array.isArray(inst) ? inst : (inst?.data || [])
      setPending(rows.filter(d => d.status === 'a_installer' && (!d.visit || d.visit.status === 'termine'
        || presetDeas.some(p => String(p._id) === String(d._id)))))
      // Posé par une visite d'installation de l'appli : celui-là l'est vraiment.
      setDeclared(rows.filter(d => d.status === 'installe'
        && !(d.visit && d.visit.status === 'termine' && !d.visit.nonPose)))
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const realSite = siteId && siteId !== NEW_SITE ? siteId : ''
  const siteName = id => siteList.find(s => s._id === id)?.name

  /* Un article réservé pour un autre site du client reste posable ici, mais
     on le signale : c'est rarement voulu. Ceux déjà rattachés à une pose
     n'apparaissent pas — ils figurent dans « Poses en attente ». */
  const freeItems = items.filter(it => !it.dea)
  const deas   = [...freeItems.filter(isDea), ...extra.filter(e => !freeItems.some(i => i._id === e._id))]
  const others = freeItems.filter(it => !isDea(it))
  const sitePending = pending.filter(d => !realSite || String(d.site?._id || '') === realSite)
  const siteDeclared = declared.filter(d => !realSite || String(d.site?._id || '') === realSite)
  // Sans date de pose, ou une date à venir : très probablement pas encore posé.
  const notYetPosed = d => !d.installationDate || new Date(d.installationDate) > new Date()

  const pickedDeaItems = deas.filter(it => picked.includes(it._id))
  const pickedOthers   = others.filter(it => picked.includes(it._id))
  const pickedPending  = [...sitePending, ...siteDeclared].filter(d => pickedDeas.includes(String(d._id)))
  const pickedDeclared = siteDeclared.filter(d => pickedDeas.includes(String(d._id)))
  const total = pickedDeaItems.length + pickedPending.length

  function toggle(id) {
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }
  function toggleDea(id) {
    const k = String(id)
    setPickedDeas(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])
  }

  function pickClient(c) {
    setClient(c)
    setSiteId('')
    setPicked([]); setPickedDeas([]); setExtra([])
    setNewSite({ name: '', street: '', city: '' })
  }

  function fail(msg) {
    setError(msg)
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!clientId) return fail('Choisissez le client.')
    if (!siteId)   return fail('Choisissez le site où poser le matériel, ou créez-en un.')
    if (siteId === NEW_SITE && !newSite.name.trim()) return fail('Donnez un nom au nouveau site.')
    if (!form.date) return fail("Indiquez la date de l'installation.")
    if (total === 0) return fail('Choisissez au moins un défibrillateur à installer.')
    const fErr = formationLinkError(fLink)
    if (fErr) return fail(fErr)

    const tech = techs.find(t => t._id === form.technicien)
    setSaving(true)
    try {
      const created = await planInstallation({
        client:        clientId,
        site:          realSite || undefined,
        newSite:       siteId === NEW_SITE ? { ...newSite, name: newSite.name.trim() } : undefined,
        scheduledDate: new Date(`${form.date}T${form.time || '09:00'}`).toISOString(),
        technician:    tech?._id || undefined,
        items:         pickedDeaItems.map(it => it._id),
        existingDeas:  pickedPending.map(d => d._id),
        others:        pickedOthers.map(it => it._id),
        location:      form.location,
        notes:         form.notes,
      })
      // La séance, s'il y en a une, se crée au jour de la visite et s'y lie.
      try { await applyFormationLink(created._id, fLink) }
      catch (err) { toast.warn(`Installation programmée, mais la formation n'a pas pu être liée : ${formatApiError(err)}`) }

      toast.success(total > 1 ? `Installation de ${total} DAE programmée.` : 'Installation programmée.')
      onDone?.(created)
    } catch (err) {
      fail(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const ItemRow = ({ it, icon: Icon }) => {
    const on = picked.includes(it._id)
    const s  = siteOfItem(it)
    const elsewhere = realSite && s && s !== realSite
    return (
      <button type="button"
        className={`inst-pick${on ? ' inst-pick--on' : ''}`}
        onClick={() => toggle(it._id)}>
        <span className="inst-pick-check">{on && <Check size={12} />}</span>
        <Icon size={14} className="inst-pick-icon" />
        <span className="inst-pick-main">
          <span className="inst-pick-name">{it.product?.name || 'Article'}</span>
          <span className="inst-pick-sub">
            {it.serialNumber || it.lotNumber || 'sans numéro'}
            {it.status === 'disponible' && <> · disponible (sera réservé)</>}
            {it.reservedFor?.site?.name && <> · réservé pour {it.reservedFor.site.name}</>}
            {elsewhere && !it.reservedFor?.site?.name && siteName(s) && <> · réservé pour {siteName(s)}</>}
          </span>
        </span>
        {elsewhere && <AlertTriangle size={13} className="inst-pick-warn" title="Réservé pour un autre site" />}
      </button>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title"><CalendarClock size={16} /> Programmer une installation</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" ref={bodyRef}>
          {error && <div className="login-error" style={{ marginBottom: 12 }}><AlertTriangle size={13} /> {error}</div>}

          {!presetClientId && (
            <div className="form-group">
              <label className="form-label">Client <span style={{ color: 'var(--red-500)' }}>*</span></label>
              <ClientSearchInput clientId={client?.id} clientName={client?.name} onChange={pickClient} />
            </div>
          )}

          {clientId && (
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
                <option value={NEW_SITE}>+ Nouveau site…</option>
              </select>
              {siteList.length === 0 && (
                <p className="form-hint"><Building2 size={11} /> Ce client n'a pas encore de site : il sera créé avec la pose.</p>
              )}
            </div>
          )}

          {siteId === NEW_SITE && (
            <div className="inst-newsite">
              <div className="form-group">
                <label className="form-label">Nom du site <span style={{ color: 'var(--red-500)' }}>*</span></label>
                <input className="form-input form-input--plain" value={newSite.name}
                  onChange={e => setNewSite(s => ({ ...s, name: e.target.value }))} placeholder="Ex : Siège, Agence Sfax" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Adresse</label>
                  <input className="form-input form-input--plain" value={newSite.street}
                    onChange={e => setNewSite(s => ({ ...s, street: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Ville</label>
                  <input className="form-input form-input--plain" value={newSite.city}
                    onChange={e => setNewSite(s => ({ ...s, city: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {clientId && (
            <>
              <div className="form-section-title" style={{ marginTop: 4 }}>Matériel à poser</div>

              {loading ? (
                <div className="table-loading"><span className="spinner" /></div>
              ) : (
                <>
                  {sitePending.length > 0 && (
                    <>
                      <span className="form-label-opt"><Clock size={11} /> Poses en attente de programmation</span>
                      <div className="inst-pick-list">
                        {sitePending.map(d => {
                          const on = pickedDeas.includes(String(d._id))
                          return (
                            <button type="button" key={d._id}
                              className={`inst-pick${on ? ' inst-pick--on' : ''}`}
                              onClick={() => toggleDea(d._id)}>
                              <span className="inst-pick-check">{on && <Check size={12} />}</span>
                              <HeartPulse size={14} className="inst-pick-icon" />
                              <span className="inst-pick-main">
                                <span className="inst-pick-name">{d.deviceType || 'DAE'}</span>
                                <span className="inst-pick-sub">
                                  {d.serialNumber || 'sans numéro'}{d.site?.name && <> · {d.site.name}</>}
                                  {d.visit?.nonPose && <> · non posé lors de la dernière visite</>}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}

                  {deas.length > 0 && (
                    <>
                      <span className="form-label-opt">Défibrillateurs réservés pour ce client</span>
                      <div className="inst-pick-list">
                        {deas.map(it => <ItemRow key={it._id} it={it} icon={HeartPulse} />)}
                      </div>
                    </>
                  )}

                  {siteDeclared.length > 0 && (
                    <>
                      <span className="form-label-opt">
                        <HeartPulse size={11} /> Déjà au parc de ce site — à choisir s'ils ne sont pas encore posés
                      </span>
                      <div className="inst-pick-list">
                        {[...siteDeclared].sort((a, b) => notYetPosed(b) - notYetPosed(a)).map(d => {
                          const on = pickedDeas.includes(String(d._id))
                          return (
                            <button type="button" key={d._id}
                              className={`inst-pick${on ? ' inst-pick--on' : ''}`}
                              onClick={() => toggleDea(d._id)}>
                              <span className="inst-pick-check">{on && <Check size={12} />}</span>
                              <HeartPulse size={14} className="inst-pick-icon" />
                              <span className="inst-pick-main">
                                <span className="inst-pick-name">{d.deviceType || 'DAE'}</span>
                                <span className="inst-pick-sub">
                                  {d.serialNumber || 'sans numéro'}{d.site?.name && <> · {d.site.name}</>}
                                  {' · '}{d.installationDate
                                    ? `pose déclarée le ${new Date(d.installationDate).toLocaleDateString('fr-FR')}`
                                    : 'sans date de pose'}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      {pickedDeclared.length > 0 && (
                        <p className="form-hint">
                          <AlertTriangle size={11} /> {pickedDeclared.length > 1 ? 'Ces appareils repasseront' : 'Cet appareil repassera'}
                          {' '}« à installer » jusqu'à la clôture de l'installation, qui fixera la vraie date de pose.
                        </p>
                      )}
                    </>
                  )}

                  {deas.length === 0 && sitePending.length === 0 && siteDeclared.length === 0 && (
                    <p className="cd-empty-hint">
                      Aucun défibrillateur réservé pour ce client. Choisissez-en un dans le stock ci-dessous :
                      il sera réservé pour cette pose.
                    </p>
                  )}

                  <StockPicker
                    exclude={[...deas.map(d => d._id)]}
                    onPick={it => { setExtra(x => [...x, it]); setPicked(p => [...p, it._id]) }}
                  />

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
            </>
          )}

          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label className="form-label">Date <span style={{ color: 'var(--red-500)' }}>*</span></label>
              <input type="date" className="form-input form-input--plain"
                value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="form-group" style={{ maxWidth: 130 }}>
              <label className="form-label">Heure</label>
              <input type="time" className="form-input form-input--plain"
                value={form.time} onChange={e => set('time', e.target.value)} />
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

          <FormationLinkFields siteId={realSite} value={fLink} onChange={setFLink}
            noSiteHint="Choisissez d'abord un site existant." />

          {total > 1 && (
            <p className="form-hint">
              <Building2 size={11} /> Une seule visite pour {total} appareils — une fiche par appareil,
              chacun avec son propre suivi.
            </p>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <span className="login-btn-spinner" /> : 'Programmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Recherche d'un défibrillateur disponible dans le stock, par n° de série
 * ou modèle. L'appareil choisi rejoint la liste et sera réservé à la pose.
 */
function StockPicker({ exclude = [], onPick }) {
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [busy,    setBusy]    = useState(false)
  const timer = useRef(null)

  const excluded = useMemo(() => new Set(exclude.map(String)), [exclude])

  useEffect(() => {
    if (!open) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setBusy(true)
      getProductItems({ category: DEA_CATEGORY, status: 'disponible', search: query.trim(), limit: 20 })
        .then(res => setResults(Array.isArray(res?.data) ? res.data : []))
        .catch(() => setResults([]))
        .finally(() => setBusy(false))
    }, 250)
    return () => clearTimeout(timer.current)
  }, [open, query])

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--sm" style={{ marginBottom: 10 }} onClick={() => setOpen(true)}>
        <Plus size={13} /> Prendre un DAE disponible en stock
      </button>
    )
  }

  const list = results.filter(r => !excluded.has(String(r._id)))
  return (
    <div className="inst-stock">
      <div className="inst-stock-search">
        <Search size={13} />
        <input autoFocus className="form-input form-input--plain" value={query}
          onChange={e => setQuery(e.target.value)} placeholder="N° de série ou modèle…" />
        <button type="button" className="modal-close" onClick={() => setOpen(false)}><X size={14} /></button>
      </div>
      {busy ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : list.length === 0 ? (
        <p className="form-hint">Aucun défibrillateur disponible{query ? ' pour cette recherche' : ''}.</p>
      ) : (
        <div className="inst-pick-list">
          {list.slice(0, 8).map(it => (
            <button type="button" key={it._id} className="inst-pick" onClick={() => { onPick(it); setOpen(false); setQuery('') }}>
              <span className="inst-pick-check"><Plus size={12} style={{ color: 'var(--text-secondary)' }} /></span>
              <HeartPulse size={14} className="inst-pick-icon" />
              <span className="inst-pick-main">
                <span className="inst-pick-name">{it.product?.name || 'DAE'}</span>
                <span className="inst-pick-sub">{it.serialNumber || 'sans numéro'} · disponible</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
