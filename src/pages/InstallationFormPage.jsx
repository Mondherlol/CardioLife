import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Zap, Users, MapPin, Battery,
  Plus, X, Trash2, Activity, Calendar, FileText,
  Save, ChevronDown, Search, RefreshCw, CheckCircle2, AlertTriangle, Lock,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { getClients }          from '../api/clients'
import { getProducts, getMovements } from '../api/products'
import { getUsers }            from '../api/users'
import { getInstallation, createInstallation, updateInstallation } from '../api/installations'
import ComboSearch              from '../components/ComboSearch'
import ClientModal              from '../components/ClientModal'
import ProductModal             from '../components/ProductModal'

/* Numéros de série actuellement en stock pour un produit (entrées − sorties) */
function computeInStockSerials(movements) {
  const entered = new Set(), exited = new Set()
  ;(movements || []).forEach(mv => {
    if (mv.type === 'entree' || mv.type === 'serialisation') (mv.serialNumbers || []).forEach(s => entered.add(s))
    if (mv.type === 'sortie') (mv.serialNumbers || []).forEach(s => exited.add(s))
  })
  return [...entered].filter(s => !exited.has(s))
}

/* ─── Helpers ───────────────────────────────────────────────── */
function toDateInput(d) {
  if (!d) return ''
  try { return new Date(d).toISOString().split('T')[0] } catch { return '' }
}

function todayStr() { return toDateInput(new Date().toISOString()) }

function addMonths(dateStr, n) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + n)
  return toDateInput(d.toISOString())
}

function newBattery()  {
  return { _key: Date.now() + Math.random(), product: null, expiryDate: '', activationDate: todayStr(), level: '100', notes: '' }
}
function newElectrode() {
  return { _key: Date.now() + Math.random(), product: null, expiryDate: '', notes: '' }
}

/* ─── Battery card ──────────────────────────────────────────── */
function BatteryCard({ batt, batteryProducts, onChange, onRemove, onCreateProduct }) {
  function set(k, v) { onChange({ ...batt, [k]: v }) }
  const lvl = batt.level !== '' ? Number(batt.level) : null
  const lvlCls = lvl == null ? '' : lvl < 25 ? 'lvl--red' : lvl < 50 ? 'lvl--amber' : 'lvl--green'

  return (
    <div className="ifc-component ifc-component--battery">
      <div className="ifc-comp-head">
        <span className="ifc-comp-icon ifc-comp-icon--battery"><Battery size={13} /></span>
        <span className="ifc-comp-label">Batterie</span>
        <button type="button" className="ifc-comp-rm" onClick={onRemove}><X size={13} /></button>
      </div>
      <div className="ifc-comp-body">
        <div className="form-group">
          <label className="form-label">Modèle</label>
          <ComboSearch
            items={batteryProducts}
            value={batt.product}
            onChange={p => set('product', p)}
            onClear={() => set('product', null)}
            displayFn={p => p.name}
            subtextFn={p => p.reference || p.brand || null}
            placeholder="Rechercher une batterie…"
            onCreateNew={onCreateProduct}
            emptyText="Aucune batterie dans le catalogue"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Activation</label>
            <input type="date" className="form-input form-input--plain"
              value={batt.activationDate} onChange={e => set('activationDate', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Expiration / Garantie</label>
            <input type="date" className="form-input form-input--plain"
              value={batt.expiryDate} onChange={e => set('expiryDate', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Niveau (%)</label>
            <div className="ifc-level-wrap">
              <input type="number" min="0" max="100" className="form-input form-input--plain ifc-level-input"
                value={batt.level} onChange={e => set('level', e.target.value)} placeholder="100" />
              {lvl != null && (
                <div className="ifc-level-track">
                  <div className={`ifc-level-fill ${lvlCls}`} style={{ width: `${Math.min(100, lvl)}%` }} />
                </div>
              )}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input form-input--plain"
              value={batt.notes} onChange={e => set('notes', e.target.value)} placeholder="Observations…" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Electrode card ────────────────────────────────────────── */
function ElectrodeCard({ elec, electrodeProducts, onChange, onRemove, onCreateProduct }) {
  function set(k, v) { onChange({ ...elec, [k]: v }) }
  return (
    <div className="ifc-component ifc-component--electrode">
      <div className="ifc-comp-head">
        <span className="ifc-comp-icon ifc-comp-icon--electrode"><Zap size={13} /></span>
        <span className="ifc-comp-label">Électrode</span>
        <button type="button" className="ifc-comp-rm" onClick={onRemove}><X size={13} /></button>
      </div>
      <div className="ifc-comp-body">
        <div className="form-group">
          <label className="form-label">Modèle</label>
          <ComboSearch
            items={electrodeProducts}
            value={elec.product}
            onChange={p => set('product', p)}
            onClear={() => set('product', null)}
            displayFn={p => p.name}
            subtextFn={p => p.reference || p.brand || null}
            placeholder="Rechercher une électrode…"
            onCreateNew={onCreateProduct}
            emptyText="Aucune électrode dans le catalogue"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Expiration</label>
            <input type="date" className="form-input form-input--plain"
              value={elec.expiryDate} onChange={e => set('expiryDate', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input form-input--plain"
              value={elec.notes} onChange={e => set('notes', e.target.value)} placeholder="P = prévu, N = neuve…" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Control type pill ─────────────────────────────────────── */
function ControlTypePills({ value, onChange }) {
  const opts = [
    { value: 'semestriel', label: 'Semestriel', desc: 'tous les 6 mois' },
    { value: 'annuel',     label: 'Annuel',     desc: 'tous les 12 mois' },
  ]
  return (
    <div className="ifc-type-pills">
      {opts.map(o => (
        <button key={o.value} type="button"
          className={`ifc-type-pill${value === o.value ? ' ifc-type-pill--on' : ''}`}
          onClick={() => onChange(value === o.value ? '' : o.value)}>
          <span className="ifc-type-pill-label">{o.label}</span>
          <span className="ifc-type-pill-desc">{o.desc}</span>
        </button>
      ))}
    </div>
  )
}

/* ─── Form card wrapper ─────────────────────────────────────── */
function FormCard({ icon: Icon, color, title, children, action }) {
  return (
    <div className="ifc-card">
      <div className="ifc-card-head">
        <div className="ifc-card-icon" style={{ background: color + '18', color }}>
          <Icon size={15} />
        </div>
        <h3 className="ifc-card-title">{title}</h3>
        {action && <div className="ifc-card-action">{action}</div>}
      </div>
      <div className="ifc-card-body">{children}</div>
    </div>
  )
}

/* ─── Main Page ─────────────────────────────────────────────── */

export default function InstallationFormPage() {
  const { id }  = useParams()
  const navigate = useNavigate()
  const isEdit   = !!id

  /* ── Data ── */
  const [clients,   setClients]  = useState([])
  const [products,  setProducts] = useState([])
  const [dataReady, setDataReady] = useState(false)

  /* ── Form state ── */
  const [selectedClient, setClient]    = useState(null)
  const [selectedDevice, setDevice]    = useState(null)
  const [address,      setAddress]     = useState('')
  const [location,     setLocation]    = useState('')
  const [serialNumber, setSerial]      = useState('')
  const [installDate,  setInstDate]    = useState(isEdit ? '' : todayStr())
  const [technician,     setTechnician]     = useState('')
  const [technicianName, setTechnicianName] = useState('')
  const [technicians,    setTechnicians]    = useState([])
  const [fromContract,   setFromContract]   = useState(false)
  const [inStockSerials, setInStockSerials] = useState([])
  const [batteries,    setBatteries]   = useState([])
  const [electrodes,   setElectrodes]  = useState([])
  const [notes,        setNotes]       = useState('')
  const [loadedStatus, setLoadedStatus]= useState(null)
  const [errors,       setErrors]      = useState({})
  const [saving,       setSaving]      = useState(false)

  /* ── Modal states ── */
  const [clientModalOpen, setClientModal]  = useState(false)
  const [productModalFor, setProductModal] = useState(null)

  /* ── Filtered product lists ── */
  const deviceProducts    = useMemo(() => products.filter(p => p.category === 'defibrillateur'), [products])
  const batteryProducts   = useMemo(() => products.filter(p => p.category === 'batterie'), [products])
  const electrodeProducts = useMemo(() => products.filter(p =>
    p.category === 'electrodes_adulte' || p.category === 'electrodes_enfant'
  ), [products])

  /* ── Techniciens (pour l'affectation de la pose) ── */
  useEffect(() => {
    getUsers().then(d => {
      const list = Array.isArray(d) ? d : (d?.data || [])
      setTechnicians(list.filter(u => u.role === 'technicien'))
    }).catch(() => {})
  }, [])

  /* ── N° de série en stock pour l'appareil sélectionné ── */
  useEffect(() => {
    const pid = selectedDevice?._id
    if (!pid || selectedDevice?._stub) { setInStockSerials([]); return }
    getMovements(pid)
      .then(raw => setInStockSerials(computeInStockSerials(Array.isArray(raw) ? raw : (raw.data || []))))
      .catch(() => setInStockSerials([]))
  }, [selectedDevice])

  /* ── Auto-fill address from client (create mode only) ── */
  useEffect(() => {
    if (!isEdit && selectedClient) {
      const addr = selectedClient.address
      if (addr) {
        const parts = [addr.street, addr.city, addr.governorate].filter(Boolean)
        if (parts.length) setAddress(parts.join(', '))
      }
    }
  }, [selectedClient, isEdit])

  /* ── Load data ── */
  useEffect(() => {
    Promise.all([
      getClients({ limit: 500 }),
      getProducts({ limit: 500 }),
    ]).then(([cr, pr]) => {
      const clientList  = cr.data  || cr
      const productList = pr.data  || pr
      setClients(clientList)
      setProducts(productList)
      setDataReady(true)
      return { clientList, productList }
    }).then(({ clientList, productList }) => {
      if (isEdit) return getInstallation(id).then(inst => populateForm(inst, clientList, productList))
    }).catch(err => toast.error(err.message || 'Erreur de chargement.'))
  }, [id, isEdit])

  function populateForm(inst, clientList, productList) {
    setLoadedStatus(inst.status || 'installe')
    setFromContract(!!inst.contract)
    setClient(clientList.find(c => c._id === (inst.client?._id || inst.client)) || inst.client || null)
    setAddress(inst.address || '')
    setLocation(inst.location || '')
    setSerial(inst.serialNumber || '')
    setInstDate(toDateInput(inst.installationDate))
    setTechnician(inst.technician?._id || (typeof inst.technician === 'string' ? inst.technician : '') || '')
    setTechnicianName(inst.technicianName || inst.technician?.fullName || '')
    setNotes(inst.notes || '')
    const devId = inst.deviceProduct?._id || inst.deviceProduct
    if (devId) {
      setDevice(productList.find(p => p._id === devId)
        || { _id: devId, name: inst.deviceProduct?.name || inst.deviceType })
    } else if (inst.deviceType) {
      setDevice({ _stub: true, name: inst.deviceType })
    }
    setBatteries((inst.batteries || []).map(b => ({
      _key: Math.random(),
      product: b.product
        ? (productList.find(p => p._id === b.product) || { _id: b.product, name: b.productName })
        : null,
      expiryDate:     toDateInput(b.expiryDate),
      activationDate: toDateInput(b.activationDate),
      level:          b.level != null ? String(b.level) : '',
      notes:          b.notes || '',
    })))
    setElectrodes((inst.electrodes || []).map(e => ({
      _key: Math.random(),
      product: e.product
        ? (productList.find(p => p._id === e.product) || { _id: e.product, name: e.productName })
        : null,
      expiryDate: toDateInput(e.expiryDate),
      notes:      e.notes || '',
    })))
  }

  function handleClientCreated(client) {
    setClients(prev => [client, ...prev])
    setClient(client)
    setClientModal(false)
  }

  function handleProductCreated(product) {
    setProducts(prev => [product, ...prev])
    if (productModalFor?.type === 'device')    setDevice(product)
    else if (productModalFor?.type === 'battery')
      setBatteries(prev => prev.map(b => b._key === productModalFor.key ? { ...b, product } : b))
    else if (productModalFor?.type === 'electrode')
      setElectrodes(prev => prev.map(e => e._key === productModalFor.key ? { ...e, product } : e))
    setProductModal(null)
  }

  function validate() {
    const e = {}
    if (!selectedClient) e.client  = 'Veuillez sélectionner un client.'
    if (!address.trim()) e.address = 'L\'adresse est requise.'
    return e
  }

  function buildPayload() {
    const tech = technicians.find(t => t._id === technician)
    return {
      client:     selectedClient?._id,
      clientName: selectedClient?.name,
      address:    address.trim(),
      location:   location.trim()   || undefined,
      installationDate: installDate || undefined,
      technician:     technician || undefined,
      technicianName: tech ? (tech.fullName || tech.username) : (technicianName || undefined),
      deviceProduct: selectedDevice?._id && !selectedDevice?._stub ? selectedDevice._id : undefined,
      deviceType:    selectedDevice?.name || undefined,
      serialNumber:  serialNumber.trim() || undefined,
      batteries: batteries.map(b => ({
        product:        b.product?._id && !b.product?._stub ? b.product._id : undefined,
        productName:    b.product?.name || undefined,
        expiryDate:     b.expiryDate     || undefined,
        activationDate: b.activationDate || undefined,
        level:          b.level !== '' ? Number(b.level) : undefined,
        notes:          b.notes.trim()   || undefined,
      })),
      electrodes: electrodes.map(e => ({
        product:     e.product?._id && !e.product?._stub ? e.product._id : undefined,
        productName: e.product?.name || undefined,
        expiryDate:  e.expiryDate   || undefined,
        notes:       e.notes.trim() || undefined,
      })),
      notes: notes.trim() || undefined,
    }
  }

  async function persist() {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      const payload = buildPayload()
      if (!isEdit) {
        const created = await createInstallation(payload)
        toast.success('Installation créée.')
        navigate(`/devices/${created._id}`)
      } else {
        await updateInstallation(id, payload)
        toast.success('Installation mise à jour.')
        navigate(`/devices/${id}`)
      }
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit(e) { e.preventDefault(); persist() }

  const isPending = isEdit && loadedStatus === 'a_installer'

  // Vérif n° de série vs stock (create ou pose en attente uniquement — un appareil
  // déjà installé a été déduit du stock, ne pas alerter dans ce cas).
  const deviceIsProduct = selectedDevice?._id && !selectedDevice?._stub
  const serialTrim      = serialNumber.trim()
  const checkSerial     = !isEdit || loadedStatus === 'a_installer'
  const serialInStock   = !!(deviceIsProduct && serialTrim && inStockSerials.includes(serialTrim))
  const serialMissing   = checkSerial && deviceIsProduct && !!serialTrim && !serialInStock

  /* ─── Render ──────────────────────────────────────────────── */
  return (
    <div className="page-content">

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="back-btn" onClick={() => navigate(isEdit ? `/devices/${id}` : '/devices')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title" style={{ marginBottom: 2 }}>
              {isEdit ? 'Modifier l\'installation' : 'Nouvelle installation'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {isEdit
                ? 'Mettez à jour les informations de cette installation.'
                : 'Enregistrez un défibrillateur installé chez un client.'}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="ifc-form">

        {/* ── 1. Client & Site ─────────────────────── */}
        <FormCard icon={Users} color="#f97316" title="Client & Site">
          {fromContract ? (
            <div className="ifc-two-col">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Client</label>
                <div className="ifc-readonly-field">{selectedClient?.name || '—'}</div>
                <p className="ifc-locked-hint"><Lock size={10} /> Défini par le contrat</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Adresse du site</label>
                  <div className="ifc-readonly-field">{address || '—'}</div>
                </div>
                {location && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Lieu précis</label>
                    <div className="ifc-readonly-field">{location}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="ifc-two-col">
              <div>
                <label className="form-label">Client *</label>
                <ComboSearch
                  items={clients.filter(c => c.isActive !== false)}
                  value={selectedClient}
                  onChange={c => { setClient(c); setErrors(e => ({ ...e, client: undefined })) }}
                  onClear={() => setClient(null)}
                  displayFn={c => c.name}
                  subtextFn={c => [c.address?.city, c.address?.governorate].filter(Boolean).join(', ') || null}
                  placeholder="Rechercher un client…"
                  onCreateNew={() => setClientModal(true)}
                  emptyText="Aucun client trouvé"
                />
                {errors.client && <p className="form-error">{errors.client}</p>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Adresse du site *
                    {selectedClient?.address && !isEdit && (
                      <button type="button" className="ifc-autofill-btn"
                        onClick={() => {
                          const a = selectedClient.address
                          const parts = [a.street, a.city, a.governorate].filter(Boolean)
                          setAddress(parts.join(', '))
                        }}>
                        <RefreshCw size={10} /> Auto
                      </button>
                    )}
                  </label>
                  <input
                    className={`form-input form-input--plain${errors.address ? ' form-input--error' : ''}`}
                    value={address}
                    onChange={e => { setAddress(e.target.value); setErrors(err => ({ ...err, address: undefined })) }}
                    placeholder="ex. Avenue Habib Bourguiba, Tunis…"
                  />
                  {errors.address && <span className="form-error">{errors.address}</span>}
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Lieu précis</label>
                  <input className="form-input form-input--plain" value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="ex. 2ème étage, Réception, Hall…" />
                </div>
              </div>
            </div>
          )}
        </FormCard>

        {/* ── 2. Appareil DAE ──────────────────────── */}
        <FormCard icon={Zap} color="#3b82f6" title="Appareil DAE">
          <div className="ifc-two-col">
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Modèle DAE</label>
              {fromContract ? (
                <>
                  <div className="ifc-readonly-field">{selectedDevice?.name || '—'}</div>
                  <p className="ifc-locked-hint"><Lock size={10} /> Défini par le contrat</p>
                </>
              ) : (
                <ComboSearch
                  items={deviceProducts}
                  value={selectedDevice}
                  onChange={setDevice}
                  onClear={() => setDevice(null)}
                  displayFn={p => p.name}
                  subtextFn={p => [p.brand, p.reference].filter(Boolean).join(' · ') || null}
                  placeholder="ZOLL, Philips, Schiller…"
                  onCreateNew={() => setProductModal({ type: 'device' })}
                  emptyText="Aucun défibrillateur dans le catalogue"
                />
              )}
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Numéro de série</label>
              <input className={`form-input form-input--plain${serialMissing ? ' form-input--warn' : ''}`}
                value={serialNumber}
                onChange={e => setSerial(e.target.value)} placeholder="ex. D00000096721" />
              {serialMissing && (
                <p className="ifc-serial-warn">
                  <AlertTriangle size={11} /> Absent du stock de « {selectedDevice?.name} » — il sera ajouté au stock puis déduit à l'installation (traçabilité).
                </p>
              )}
              {serialInStock && (
                <p className="ifc-serial-ok">
                  <CheckCircle2 size={11} /> En stock — sera déduit à l'installation.
                </p>
              )}
            </div>
          </div>

          {!isPending && (
            <>
              <div className="ifc-divider" />
              <div className="ifc-two-col">
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Date d'installation</label>
                  <input type="date" className="form-input form-input--plain"
                    value={installDate} onChange={e => setInstDate(e.target.value)} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Intervenant / installateur</label>
                  <select className="form-input form-input--plain" value={technician}
                    onChange={e => setTechnician(e.target.value)}>
                    <option value="">— Non assigné</option>
                    {technicians.map(t => <option key={t._id} value={t._id}>{t.fullName || t.username}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
          {isPending && (
            <p className="ifc-locked-hint" style={{ marginTop: 10 }}>
              <Lock size={10} /> La date, l'heure et l'intervenant se gèrent depuis la section « Planifier l'installation » de la fiche.
            </p>
          )}
        </FormCard>

        {/* ── 3. Composants ───────────────────────── */}
        <FormCard
          icon={Activity}
          color="#8b5cf6"
          title="Composants"
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ifc-add-comp ifc-add-comp--battery"
                onClick={() => setBatteries(prev => [...prev, newBattery()])}>
                <Battery size={13} /> Batterie
              </button>
              <button type="button" className="ifc-add-comp ifc-add-comp--electrode"
                onClick={() => setElectrodes(prev => [...prev, newElectrode()])}>
                <Zap size={13} /> Électrode
              </button>
            </div>
          }
        >
          {batteries.length === 0 && electrodes.length === 0 ? (
            <div className="ifc-comp-empty">
              <Activity size={32} color="var(--gray-300)" />
              <p>Aucun composant ajouté. Utilisez les boutons ci-dessus.</p>
            </div>
          ) : (
            <div className="ifc-components-list">
              {batteries.map((batt, idx) => (
                <BatteryCard
                  key={batt._key}
                  batt={batt}
                  batteryProducts={batteryProducts}
                  onChange={updated => setBatteries(prev => prev.map((b, i) => i === idx ? updated : b))}
                  onRemove={() => setBatteries(prev => prev.filter((_, i) => i !== idx))}
                  onCreateProduct={() => setProductModal({ type: 'battery', key: batt._key })}
                />
              ))}
              {electrodes.map((elec, idx) => (
                <ElectrodeCard
                  key={elec._key}
                  elec={elec}
                  electrodeProducts={electrodeProducts}
                  onChange={updated => setElectrodes(prev => prev.map((e, i) => i === idx ? updated : e))}
                  onRemove={() => setElectrodes(prev => prev.filter((_, i) => i !== idx))}
                  onCreateProduct={() => setProductModal({ type: 'electrode', key: elec._key })}
                />
              ))}
            </div>
          )}
        </FormCard>

        {/* ── 4. Notes ─────────────────────────────── */}
        <FormCard icon={FileText} color="#6b7280" title="Notes">
          <textarea className="form-input form-input--plain form-textarea"
            rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Observations, remarques, historique de l'installation…" />
        </FormCard>

        {/* Footer */}
        <div className="ifc-footer">
          <button type="button" className="btn btn--ghost"
            onClick={() => navigate(isEdit ? `/devices/${id}` : '/devices')}>
            Annuler
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving || !dataReady}>
            {saving ? <span className="spinner spinner--sm" /> : <Save size={14} />}
            {isEdit ? 'Enregistrer' : 'Créer l\'installation'}
          </button>
        </div>

      </form>

      {clientModalOpen && (
        <ClientModal client={null} onClose={() => setClientModal(false)} onSaved={handleClientCreated} />
      )}

      {productModalFor && (
        <ProductModal
          product={null}
          defaultCategory={
            productModalFor.type === 'device'    ? 'defibrillateur' :
            productModalFor.type === 'battery'   ? 'batterie' :
            productModalFor.type === 'electrode' ? 'electrodes_adulte' : ''
          }
          onClose={() => setProductModal(null)}
          onSaved={handleProductCreated}
        />
      )}
    </div>
  )
}
