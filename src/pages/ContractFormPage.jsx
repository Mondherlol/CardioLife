import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, FileText, Users, Save, Boxes, Package, GraduationCap,
  Zap, Battery, Plus, X, Link2, Calendar, RefreshCw, Tag, Hash, MapPin,
} from 'lucide-react'
import { getClients }      from '../api/clients'
import { getProducts }     from '../api/products'
import { getPacks }        from '../api/packs'
import {
  getContract, createContract, updateContract, getNextNumber,
} from '../api/contracts'
import ComboSearch from '../components/ComboSearch'
import ClientModal from '../components/ClientModal'

/* ── Helpers ── */
function toDateInput(d) {
  if (!d) return ''
  try { return new Date(d).toISOString().split('T')[0] } catch { return '' }
}
function todayStr() { return toDateInput(new Date().toISOString()) }
function addMonths(dateStr, n) {
  if (!dateStr) return ''
  const d = new Date(dateStr); d.setMonth(d.getMonth() + n)
  return toDateInput(d.toISOString())
}
function key() { return `${Date.now()}-${Math.random()}` }
function formatPrice(v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toLocaleString('fr-FR')} DT`
}
function clientAddress(c) {
  if (!c?.address) return ''
  return [c.address.street, c.address.city, c.address.governorate].filter(Boolean).join(', ')
}

/* ── Wrapper carte de formulaire ── */
function FormCard({ icon: Icon, color, title, children, action }) {
  return (
    <div className="ifc-card">
      <div className="ifc-card-head">
        <div className="ifc-card-icon" style={{ background: color + '18', color }}><Icon size={15} /></div>
        <h3 className="ifc-card-title">{title}</h3>
        {action && <div className="ifc-card-action">{action}</div>}
      </div>
      <div className="ifc-card-body">{children}</div>
    </div>
  )
}

export default function ContractFormPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const isEdit   = !!id

  /* ── Données de référence ── */
  const [clients,   setClients]   = useState([])
  const [products,  setProducts]  = useState([])
  const [packs,     setPacks]     = useState([])
  const [dataReady, setDataReady] = useState(false)

  /* ── État du contrat ── */
  const [selectedClient, setClient]   = useState(null)
  const [contractNumber, setNumber]   = useState('')
  const [status,      setStatus]      = useState('actif')
  const [startDate,   setStartDate]   = useState(isEdit ? '' : todayStr())
  const [endDate,     setEndDate]     = useState(isEdit ? '' : addMonths(todayStr(), 12))
  const [periodicity, setPeriodicity] = useState('annuel')
  const [notes,       setNotes]       = useState('')

  const [lineItems,     setLineItems]     = useState([])   // { _key, product, productName, category, quantity, unitPrice, fromPack }
  const [services,      setServices]      = useState([])   // { _key, name, price, fromPack }
  const [packRefs,      setPackRefs]      = useState([])   // { pack, name }

  const [errors,  setErrors]  = useState({})
  const [saving,  setSaving]  = useState(false)
  const [clientModalOpen, setClientModal] = useState(false)

  /* ── Chargement ── */
  useEffect(() => {
    Promise.all([
      getClients({ limit: 500 }),
      getProducts({ limit: 500 }),
      getPacks({ limit: 500 }),
      isEdit ? getNextNumber().catch(() => ({ number: '' })) : getNextNumber(),
    ]).then(([cr, pr, pk, nn]) => {
      const clientList = cr.data || cr
      setClients(clientList)
      setProducts(pr.data || pr)
      setPacks(pk.data || pk)
      if (!isEdit) setNumber(nn.number || '')
      setDataReady(true)
      return clientList
    }).then(clientList => {
      if (isEdit) return getContract(id).then(ct => populate(ct, clientList))
    }).catch(err => toast.error(err.message || 'Erreur de chargement.'))
  }, [id, isEdit])

  function populate(ct, clientList) {
    setClient(clientList.find(c => c._id === (ct.client?._id || ct.client)) || ct.client || null)
    setNumber(ct.contractNumber || '')
    setStatus(ct.status || 'actif')
    setStartDate(toDateInput(ct.startDate))
    setEndDate(toDateInput(ct.endDate))
    setPeriodicity(ct.controlPeriodicity || '')
    setNotes(ct.notes || '')
    setLineItems((ct.lineItems || []).map(li => ({
      _key: key(),
      product: li.product ? { _id: li.product._id || li.product, name: li.productName, category: li.category } : null,
      productName: li.productName, category: li.category,
      quantity: li.quantity || 1, unitPrice: li.unitPrice ?? '', fromPack: li.fromPack || '',
    })))
    setServices((ct.services || []).map(s => ({ _key: key(), name: s.name, price: s.price ?? '', fromPack: s.fromPack || '' })))
    setPackRefs((ct.packs || []).map(p => ({ pack: p.pack?._id || p.pack, name: p.name })))
  }

  /* ── Auto-fin de contrat depuis la date de début (création) ── */
  useEffect(() => {
    if (!isEdit && startDate) setEndDate(prev => prev || addMonths(startDate, 12))
  }, [startDate, isEdit])

  /* ── Ajouts ── */
  function addPack(pack) {
    setPackRefs(prev => [...prev, { pack: pack._id, name: pack.name }])
    setLineItems(prev => [
      ...prev,
      ...(pack.products || []).filter(i => i.product).map(i => ({
        _key: key(),
        product: i.product,
        productName: i.product.name,
        category: i.product.category,
        quantity: i.quantity || 1,
        unitPrice: i.product.salePrice ?? '',
        fromPack: pack.name,
      })),
    ])
    setServices(prev => [
      ...prev,
      ...(pack.services || []).map(s => ({ _key: key(), name: s.name, price: s.price ?? '', fromPack: pack.name })),
    ])
    toast.success(`Pack « ${pack.name} » ajouté.`)
  }

  function addProduct(product, qty = 1) {
    setLineItems(prev => [...prev, {
      _key: key(), product, productName: product.name, category: product.category,
      quantity: qty, unitPrice: product.salePrice ?? '', fromPack: '',
    }])
  }

  function addService() { setServices(prev => [...prev, { _key: key(), name: '', price: '', fromPack: '' }]) }

  /* ── Valeur estimée ── */
  const estimatedValue = useMemo(() => {
    const items = lineItems.reduce((s, li) => s + (Number(li.unitPrice) || 0) * (Number(li.quantity) || 1), 0)
    const svc   = services.reduce((s, x) => s + (Number(x.price) || 0), 0)
    return items + svc
  }, [lineItems, services])

  /* ── Soumission ── */
  function validate() {
    const e = {}
    if (!selectedClient) e.client = 'Veuillez sélectionner un client.'
    if (services.some(s => !s.name.trim())) e.services = 'Chaque service doit avoir un nom.'
    return e
  }

  async function handleSubmit(ev) {
    ev.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); toast.error(Object.values(errs)[0]); return }
    setSaving(true)
    try {
      const payload = {
        contractNumber: contractNumber.trim() || undefined,
        client:     selectedClient._id,
        clientName: selectedClient.name,
        status,
        startDate:  startDate || undefined,
        endDate:    endDate   || undefined,
        controlPeriodicity: periodicity || '',
        notes: notes.trim() || undefined,
        packs: packRefs,
        lineItems: lineItems.map(li => ({
          product: li.product?._id || undefined,
          productName: li.productName,
          category: li.category,
          quantity: Number(li.quantity) || 1,
          unitPrice: Number(li.unitPrice) || 0,
          fromPack: li.fromPack || undefined,
        })),
        services: services.filter(s => s.name.trim()).map(s => ({
          name: s.name.trim(), price: Number(s.price) || 0, fromPack: s.fromPack || undefined,
        })),
      }
      if (isEdit) {
        await updateContract(id, payload)
        toast.success('Contrat mis à jour.')
        navigate(`/contrats/${id}`)
      } else {
        const created = await createContract(payload)
        toast.success('Contrat créé.')
        navigate(`/contrats/${created._id}`)
      }
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  const availablePacks = packs

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="back-btn" onClick={() => navigate(isEdit ? `/contrats/${id}` : '/contrats')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title" style={{ marginBottom: 2 }}>
              {isEdit ? 'Modifier le contrat' : 'Nouveau contrat'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {isEdit ? 'Mettez à jour ce contrat.' : 'Contrat de maintenance / location lié à un client.'}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="ifc-form">

        {/* 1. Client & Infos */}
        <FormCard icon={FileText} color="#f97316" title="Informations du contrat">
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
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">N° de contrat</label>
              <div className="ct-num-wrap">
                <Hash size={13} className="ct-num-icon" />
                <input className="form-input form-input--plain" style={{ paddingLeft: 30 }}
                  value={contractNumber} onChange={e => setNumber(e.target.value)}
                  placeholder="CT-2026-0001" />
              </div>
            </div>
          </div>

          <div className="ifc-divider" />

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Statut</label>
            <div className="ct-status-pills">
              {[
                { value: 'brouillon', label: 'Brouillon' },
                { value: 'actif',     label: 'Actif' },
                { value: 'expire',    label: 'Expiré' },
                { value: 'resilie',   label: 'Résilié' },
              ].map(s => (
                <button key={s.value} type="button"
                  className={`ct-status-pill ct-status-pill--${s.value}${status === s.value ? ' ct-status-pill--on' : ''}`}
                  onClick={() => setStatus(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ifc-two-col" style={{ marginTop: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Date de début</label>
              <input type="date" className="form-input form-input--plain"
                value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Date de fin / échéance</label>
              <input type="date" className="form-input form-input--plain"
                value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 8 }}>Périodicité des contrôles</label>
            <div className="ifc-type-pills">
              {[
                { value: 'semestriel', label: 'Semestriel', desc: 'tous les 6 mois' },
                { value: 'annuel',     label: 'Annuel',     desc: 'tous les 12 mois' },
              ].map(o => (
                <button key={o.value} type="button"
                  className={`ifc-type-pill${periodicity === o.value ? ' ifc-type-pill--on' : ''}`}
                  onClick={() => setPeriodicity(periodicity === o.value ? '' : o.value)}>
                  <span className="ifc-type-pill-label">{o.label}</span>
                  <span className="ifc-type-pill-desc">{o.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </FormCard>

        {/* 2. Contenu : packs / produits / services */}
        <FormCard icon={Boxes} color="#8b5cf6" title="Contenu du contrat">
          <div className="ct-add-row">
            <div className="ct-add-block">
              <label className="form-label"><Boxes size={12} /> Ajouter un pack</label>
              <ComboSearch
                items={availablePacks}
                value={null}
                onChange={addPack}
                onClear={() => {}}
                displayFn={p => p.name}
                subtextFn={p => [
                  `${(p.products || []).length} produit(s)`,
                  p.realPrice != null && formatPrice(p.realPrice),
                ].filter(Boolean).join(' · ')}
                placeholder="Rechercher un pack…"
                emptyText="Aucun pack"
              />
            </div>
            <div className="ct-add-block">
              <label className="form-label"><Package size={12} /> Ajouter un produit seul</label>
              <ComboSearch
                items={products}
                value={null}
                onChange={p => addProduct(p, 1)}
                onClear={() => {}}
                displayFn={p => p.name}
                subtextFn={p => [p.reference && `Réf. ${p.reference}`, p.salePrice != null && formatPrice(p.salePrice)].filter(Boolean).join(' · ')}
                placeholder="Rechercher un produit…"
                emptyText="Aucun produit"
              />
            </div>
          </div>

          {/* Lignes produits */}
          {lineItems.length > 0 && (
            <div className="ct-items">
              {lineItems.map((li, idx) => (
                <div key={li._key} className="ct-item-row">
                  <span className="ct-item-icon"><Package size={13} /></span>
                  <div className="ct-item-info">
                    <div className="ct-item-name">
                      {li.productName}
                      {li.fromPack && <span className="ct-frompack-chip">pack : {li.fromPack}</span>}
                    </div>
                  </div>
                  <div className="ct-qty-mini">
                    <span>Qté</span>
                    <input type="number" min="1" value={li.quantity}
                      onChange={e => setLineItems(prev => prev.map((x, i) => i === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} />
                  </div>
                  <div className="ct-price-mini">
                    <input type="number" min="0" step="0.01" value={li.unitPrice}
                      onChange={e => setLineItems(prev => prev.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))}
                      placeholder="Prix U." />
                    <span>DT</span>
                  </div>
                  <div className="ct-line-total">{formatPrice((Number(li.unitPrice) || 0) * (Number(li.quantity) || 1))}</div>
                  <button type="button" className="pack-row-remove" onClick={() => setLineItems(prev => prev.filter((_, i) => i !== idx))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Services */}
          <div className="ct-services-head">
            <span className="pack-section-title" style={{ margin: 0 }}><GraduationCap size={14} /> Services</span>
            <button type="button" className="btn btn--ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addService}>
              <Plus size={13} /> Service
            </button>
          </div>
          {services.length > 0 && (
            <div className="ct-items">
              {services.map((s, idx) => (
                <div key={s._key} className="pack-service-row">
                  <input className="form-input form-input--plain" value={s.name}
                    onChange={e => setServices(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                    placeholder="ex. Formation secourisme" />
                  {s.fromPack && <span className="ct-frompack-chip">pack : {s.fromPack}</span>}
                  <div className="pack-service-price">
                    <input className="form-input form-input--plain" type="number" min="0" step="0.01" value={s.price}
                      onChange={e => setServices(prev => prev.map((x, i) => i === idx ? { ...x, price: e.target.value } : x))}
                      placeholder="Prix" />
                    <span className="pack-service-currency">DT</span>
                  </div>
                  <button type="button" className="pack-row-remove" onClick={() => setServices(prev => prev.filter((_, i) => i !== idx))}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(lineItems.length > 0 || services.length > 0) && (
            <div className="ct-value-bar">
              <Tag size={14} />
              <span>Valeur estimée du contrat</span>
              <strong>{formatPrice(estimatedValue)}</strong>
            </div>
          )}
        </FormCard>

        {/* 4. Notes */}
        <FormCard icon={FileText} color="#6b7280" title="Notes">
          <textarea className="form-input form-input--plain form-textarea" rows={3}
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Conditions, remarques, historique du contrat…" />
        </FormCard>

        <div className="ifc-footer">
          <button type="button" className="btn btn--ghost" onClick={() => navigate(isEdit ? `/contrats/${id}` : '/contrats')}>
            Annuler
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving || !dataReady}>
            {saving ? <span className="spinner spinner--sm" /> : <Save size={14} />}
            {isEdit ? 'Enregistrer' : 'Créer le contrat'}
          </button>
        </div>
      </form>

      {clientModalOpen && (
        <ClientModal client={null} onClose={() => setClientModal(false)}
          onSaved={c => { setClients(prev => [c, ...prev]); setClient(c); setClientModal(false) }} />
      )}
    </div>
  )
}
