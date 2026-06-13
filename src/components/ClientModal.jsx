import { useState, useEffect } from 'react'
import { X, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'react-toastify'
import { createClient, updateClient } from '../api/clients'
import { getClientTypes } from '../api/clientTypes'

const GOVERNORATES = [
  'Ariana','Béja','Ben Arous','Bizerte','Gabès','Gafsa','Jendouba',
  'Kairouan','Kasserine','Kébili','Le Kef','Mahdia','La Manouba',
  'Médenine','Monastir','Nabeul','Sfax','Sidi Bouzid','Siliana',
  'Sousse','Tataouine','Tozeur','Tunis','Zaghouan',
]

const EMPTY_FORM = {
  name: '', type: '', notes: '',
  address: { street: '', city: '', governorate: '' },
  contact:  { name: '', phones: [''], emails: [''] },
  internalManager: '',
}

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/**
 * Shared client create/edit modal.
 * Props:
 *  client   - existing client object (null → create mode)
 *  onClose  - () => void
 *  onSaved  - (client) => void  — receives the created/updated client
 */
export default function ClientModal({ client, onClose, onSaved }) {
  const isEdit = !!client?._id

  const [form, setForm] = useState(isEdit ? {
    name:            client.name,
    type:            client.type,
    notes:           client.notes || '',
    address:         { ...EMPTY_FORM.address, ...client.address },
    contact: {
      name:   client.contact?.name   || '',
      phones: client.contact?.phones?.length ? client.contact.phones : [''],
      emails: client.contact?.emails?.length ? client.contact.emails : [''],
    },
    internalManager: client.internalManager || '',
  } : {
    ...EMPTY_FORM,
    address: { ...EMPTY_FORM.address },
    contact:  { ...EMPTY_FORM.contact },
  })

  const [types,   setTypes]   = useState([])
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getClientTypes().then(setTypes).catch(() => {})
  }, [])

  function set(field, value)               { setForm(f => ({ ...f, [field]: value })) }
  function setNested(parent, field, value) { setForm(f => ({ ...f, [parent]: { ...f[parent], [field]: value } })) }

  function setArrayItem(parent, field, idx, value) {
    setForm(f => {
      const arr = [...f[parent][field]]
      arr[idx] = value
      return { ...f, [parent]: { ...f[parent], [field]: arr } }
    })
  }
  function addArrayItem(parent, field) {
    setForm(f => ({ ...f, [parent]: { ...f[parent], [field]: [...f[parent][field], ''] } }))
  }
  function removeArrayItem(parent, field, idx) {
    setForm(f => {
      const arr = f[parent][field].filter((_, i) => i !== idx)
      return { ...f, [parent]: { ...f[parent], [field]: arr.length ? arr : [''] } }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let result
      if (isEdit) {
        result = await updateClient(client._id, form)
        toast.success('Client mis à jour.')
      } else {
        result = await createClient(form)
        toast.success('Client créé avec succès.')
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
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Modifier le client' : 'Nouveau client'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-section-title">Informations générales</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Nom *</label>
              <input className="form-input form-input--plain" value={form.name}
                onChange={e => set('name', e.target.value)} placeholder="Nom de l'entreprise" required />
            </div>
            <div className="form-group">
              <label className="form-label">Type *</label>
              <select className="form-input form-input--plain" value={form.type}
                onChange={e => set('type', e.target.value)} required>
                <option value="">Sélectionner…</option>
                {types.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-section-title">Adresse</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Rue</label>
              <input className="form-input form-input--plain" value={form.address.street}
                onChange={e => setNested('address', 'street', e.target.value)} placeholder="Adresse" />
            </div>
            <div className="form-group">
              <label className="form-label">Ville</label>
              <input className="form-input form-input--plain" value={form.address.city}
                onChange={e => setNested('address', 'city', e.target.value)} placeholder="Ville" />
            </div>
          </div>
          <div className="form-group" style={{ maxWidth: '50%' }}>
            <label className="form-label">Gouvernorat</label>
            <select className="form-input form-input--plain" value={form.address.governorate}
              onChange={e => setNested('address', 'governorate', e.target.value)}>
              <option value="">Sélectionner…</option>
              {GOVERNORATES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div className="form-section-title">Contact</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Nom du contact</label>
              <input className="form-input form-input--plain" value={form.contact.name}
                onChange={e => setNested('contact', 'name', e.target.value)} placeholder="Prénom Nom" />
            </div>
            <div className="form-group">
              <label className="form-label">Responsable interne</label>
              <input className="form-input form-input--plain" value={form.internalManager}
                onChange={e => set('internalManager', e.target.value)} placeholder="Nom du responsable" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">Téléphones</label>
                <button type="button" className="add-field-btn" onClick={() => addArrayItem('contact', 'phones')}>
                  <Plus size={12} /> Ajouter
                </button>
              </div>
              {form.contact.phones.map((ph, i) => (
                <div key={i} className="array-field-row">
                  <input
                    className="form-input form-input--plain"
                    value={ph}
                    onChange={e => setArrayItem('contact', 'phones', i, e.target.value)}
                    placeholder="+216 xx xxx xxx"
                  />
                  {form.contact.phones.length > 1 && (
                    <button type="button" className="remove-field-btn" onClick={() => removeArrayItem('contact', 'phones', i)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">Emails</label>
                <button type="button" className="add-field-btn" onClick={() => addArrayItem('contact', 'emails')}>
                  <Plus size={12} /> Ajouter
                </button>
              </div>
              {form.contact.emails.map((em, i) => (
                <div key={i} className="array-field-row">
                  <input
                    className="form-input form-input--plain"
                    type="email"
                    value={em}
                    onChange={e => setArrayItem('contact', 'emails', i, e.target.value)}
                    placeholder="contact@entreprise.tn"
                  />
                  {form.contact.emails.length > 1 && (
                    <button type="button" className="remove-field-btn" onClick={() => removeArrayItem('contact', 'emails', i)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-input--plain form-textarea" value={form.notes}
              onChange={e => set('notes', e.target.value)} placeholder="Informations complémentaires…" rows={3} />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Créer le client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
