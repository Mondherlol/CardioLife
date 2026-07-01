import { useState, useEffect, useRef } from 'react'
import {
  X, AlertTriangle, Package, BarChart2, DollarSign, FileText,
  ChevronDown, CheckCircle2, Circle, Building2, Tag, Plus,
  Hash, Layers,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { createProduct, updateProduct, getSuppliers, getBrands } from '../api/products'
import { PRODUCT_CATEGORIES as CATEGORIES } from '../constants/categories'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/* ── Autocomplete + inline create ─────────────────────────── */
function AutocompleteInput({ value, onChange, suggestions, placeholder, icon: Icon }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q        = value.trim().toLowerCase()
  const filtered = suggestions.filter(s => s.toLowerCase().includes(q) && s !== value).slice(0, 7)
  const canCreate = q && !suggestions.some(s => s.toLowerCase() === q)

  return (
    <div className="ac-wrap" ref={wrapRef}>
      <input
        className="form-input form-input--plain"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && (filtered.length > 0 || canCreate) && (
        <div className="pmodal-supplier-dropdown">
          {filtered.map(s => (
            <button key={s} type="button" className="pmodal-supplier-option"
              onClick={() => { onChange(s); setOpen(false) }}
            >
              {Icon && <Icon size={12} />} {s}
            </button>
          ))}
          {canCreate && (
            <button type="button" className="pmodal-supplier-option ac-create-option"
              onClick={() => setOpen(false)}
            >
              <Plus size={12} /> Utiliser &ldquo;{value}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Toggle switch ─────────────────────────────────────────── */
function Toggle({ checked, onChange, label }) {
  return (
    <label className="ac-toggle-row">
      <span className="ac-toggle-label">{label}</span>
      <span className={`ac-toggle${checked ? ' ac-toggle--on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="ac-toggle-thumb" />
      </span>
    </label>
  )
}

/* ── Collapsible section ───────────────────────────────────── */
function Section({ icon: Icon, title, iconBg, iconColor, isOpen, onToggle, children }) {
  return (
    <div className={`pmodal-section${isOpen ? ' pmodal-section--open' : ''}`}>
      <button type="button" className="pmodal-section-hdr" onClick={onToggle}>
        <div className="pmodal-section-icon" style={{ background: iconBg, color: iconColor }}>
          <Icon size={14} />
        </div>
        <span className="pmodal-section-title">{title}</span>
        <ChevronDown
          size={15}
          className={`pmodal-section-chevron${isOpen ? ' pmodal-section-chevron--open' : ''}`}
        />
      </button>
      {isOpen && <div className="pmodal-section-body">{children}</div>}
    </div>
  )
}

/* ── Main modal ────────────────────────────────────────────── */

const EMPTY_FORM = {
  name: '', reference: '', brand: '',
  category: '', deviceMode: '',
  stock: '', alertThreshold: '5',
  requiresSerialNumber: false,
  requiresLotNumber: false,
  purchasePrice: '', salePrice: '', supplier: '', description: '', notes: '',
}

export default function ProductModal({ product, defaultCategory, onClose, onSaved }) {
  const isEdit = !!product?._id

  const [form, setForm] = useState(isEdit ? {
    name:                 product.name,
    reference:            product.reference            || '',
    brand:                product.brand                || '',
    category:             product.category,
    deviceMode:           product.deviceMode           || '',
    stock:                product.stock                ?? '',
    alertThreshold:       product.alertThreshold       ?? '5',
    requiresSerialNumber: product.requiresSerialNumber || false,
    requiresLotNumber:    product.requiresLotNumber    || false,
    purchasePrice:        product.purchasePrice        ?? '',
    salePrice:            product.salePrice            ?? '',
    supplier:             product.supplier             || '',
    description:          product.description          || '',
    notes:                product.notes                || '',
  } : { ...EMPTY_FORM, category: defaultCategory || '' })

  const [open,      setOpen]      = useState(new Set(['identification', 'stock', 'tarifs', 'description', 'notes']))
  const [suppliers, setSuppliers] = useState([])
  const [brands,    setBrands]    = useState([])
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    getSuppliers().then(setSuppliers).catch(() => {})
    getBrands().then(setBrands).catch(() => {})
  }, [])

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  function toggle(key) {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = {
        name:                 form.name,
        reference:            form.reference   || undefined,
        brand:                form.brand       || undefined,
        category:             form.category,
        deviceMode:           form.category === 'defibrillateur' && form.deviceMode ? form.deviceMode : undefined,
        alertThreshold:       form.alertThreshold !== '' ? Number(form.alertThreshold) : 5,
        requiresSerialNumber: form.requiresSerialNumber,
        requiresLotNumber:    form.requiresLotNumber,
        purchasePrice:        form.purchasePrice !== '' ? Number(form.purchasePrice) : undefined,
        salePrice:            form.salePrice    !== '' ? Number(form.salePrice)    : undefined,
        supplier:             form.supplier     || undefined,
        description:          form.description   || undefined,
        notes:                form.notes        || undefined,
      }
      // stock only on creation
      if (!isEdit) payload.stock = form.stock !== '' ? Number(form.stock) : 0

      let result
      if (isEdit) {
        result = await updateProduct(product._id, payload)
        toast.success('Produit mis à jour.')
      } else {
        result = await createProduct(payload)
        toast.success('Produit créé avec succès.')
      }
      onSaved(result)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--lg">

        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pmodal-header-icon"><Package size={16} /></div>
            <h2 className="modal-title">{isEdit ? 'Modifier le produit' : 'Nouveau produit'}</h2>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body pmodal-body">

          {/* 1 — Identification */}
          <Section
            icon={Package} title="Identification"
            iconBg="var(--orange-50)" iconColor="var(--orange-500)"
            isOpen={open.has('identification')} onToggle={() => toggle('identification')}
          >
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nom *</label>
                <input className="form-input form-input--plain" value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="ex. ZOLL AED Plus" required />
              </div>
              <div className="form-group">
                <label className="form-label">Catégorie *</label>
                <select className="form-input form-input--plain" value={form.category}
                  onChange={e => set('category', e.target.value)} required>
                  <option value="">Sélectionner…</option>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            {form.category === 'defibrillateur' && (
              <div className="form-group">
                <label className="form-label">Mode de défibrillation</label>
                <div className="pmodal-mode-row">
                  {[
                    { value: 'automatique',      label: 'Automatique',      desc: 'Le choc est délivré automatiquement' },
                    { value: 'semi-automatique', label: 'Semi-automatique', desc: "L'opérateur déclenche le choc" },
                  ].map(opt => (
                    <button
                      key={opt.value} type="button"
                      className={`pmodal-mode-btn${form.deviceMode === opt.value ? ' pmodal-mode-btn--active' : ''}`}
                      onClick={() => set('deviceMode', form.deviceMode === opt.value ? '' : opt.value)}
                    >
                      {form.deviceMode === opt.value
                        ? <CheckCircle2 size={16} className="pmodal-mode-check" />
                        : <Circle size={16} className="pmodal-mode-circle" />}
                      <div>
                        <div className="pmodal-mode-label">{opt.label}</div>
                        <div className="pmodal-mode-desc">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Référence</label>
                <input className="form-input form-input--plain" value={form.reference}
                  onChange={e => set('reference', e.target.value)} placeholder="ex. AED-PLUS-SA" />
              </div>
              <div className="form-group">
                <label className="form-label">Marque</label>
                <AutocompleteInput
                  value={form.brand}
                  onChange={v => set('brand', v)}
                  suggestions={brands}
                  placeholder="ex. ZOLL, Philips…"
                  icon={Tag}
                />
              </div>
            </div>

            {/* Traçabilité */}
            <div className="form-section-title" style={{ marginTop: 4 }}>Traçabilité des articles</div>
            <div className="ac-toggle-group">
              <Toggle
                checked={form.requiresSerialNumber}
                onChange={v => set('requiresSerialNumber', v)}
                label="Numéro de série obligatoire à chaque mouvement"
              />
              <Toggle
                checked={form.requiresLotNumber}
                onChange={v => set('requiresLotNumber', v)}
                label="Numéro de lot obligatoire à chaque entrée"
              />
            </div>
          </Section>

          {/* 2 — Stock */}
          <Section
            icon={BarChart2} title="Seuil d'alerte"
            iconBg="var(--blue-50)" iconColor="var(--blue-600)"
            isOpen={open.has('stock')} onToggle={() => toggle('stock')}
          >
            <div style={{ maxWidth: '50%' }}>
              <div className="form-group">
                <label className="form-label">Seuil d'alerte</label>
                <input className="form-input form-input--plain" type="number" min="0"
                  value={form.alertThreshold} onChange={e => set('alertThreshold', e.target.value)} placeholder="5" />
              </div>
            </div>
          </Section>

          {/* 3 — Tarifs & Fournisseur */}
          <Section
            icon={DollarSign} title="Tarifs & Fournisseur"
            iconBg="var(--green-50)" iconColor="var(--green-600)"
            isOpen={open.has('tarifs')} onToggle={() => toggle('tarifs')}
          >
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Prix d'achat (DT)</label>
                <input className="form-input form-input--plain" type="number" min="0" step="0.01"
                  value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-group">
                <label className="form-label">Prix de vente (DT)</label>
                <input className="form-input form-input--plain" type="number" min="0" step="0.01"
                  value={form.salePrice} onChange={e => set('salePrice', e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Fournisseur</label>
              <AutocompleteInput
                value={form.supplier}
                onChange={v => set('supplier', v)}
                suggestions={suppliers}
                placeholder="ex. ZOLL Europe, Philips…"
                icon={Building2}
              />
            </div>
          </Section>

          {/* 4 — Notes */}
          <Section
            icon={FileText} title="Description"
            iconBg="var(--blue-50)" iconColor="var(--blue-600)"
            isOpen={open.has('description')} onToggle={() => toggle('description')}
          >
            <textarea
              className="form-input form-input--plain form-textarea"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Colle ici la description enrichie du produit (HTML/texte formaté)."
              rows={8}
            />
          </Section>

          {/* 5 — Notes */}
          <Section
            icon={FileText} title="Notes internes"
            iconBg="var(--gray-100)" iconColor="var(--gray-500)"
            isOpen={open.has('notes')} onToggle={() => toggle('notes')}
          >
            <textarea className="form-input form-input--plain form-textarea"
              value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Informations complémentaires…" rows={3} />
          </Section>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Créer le produit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
