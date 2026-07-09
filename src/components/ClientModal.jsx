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

const EMPTY_PERSON = { name: '', phone: '', email: '' }

const EMPTY_FORM = {
  name: '', type: '', notes: '',
  address: { street: '', city: '', governorate: '' },
  contacts: [{ ...EMPTY_PERSON }],
  internalManagers: [],
}

function hydratePersons(list, fallback) {
  if (!list?.length) return fallback
  return list.map(p => ({ name: p.name || '', phone: p.phone || '', email: p.email || '' }))
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
    name:             client.name,
    type:             client.type,
    notes:            client.notes || '',
    address:          { ...EMPTY_FORM.address, ...client.address },
    contacts:         hydratePersons(client.contacts, [{ ...EMPTY_PERSON }]),
    internalManagers: hydratePersons(client.internalManagers, []),
  } : {
    ...EMPTY_FORM,
    address:  { ...EMPTY_FORM.address },
    contacts: [{ ...EMPTY_PERSON }],
    internalManagers: [],
  })

  const [types,   setTypes]   = useState([])
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getClientTypes().then(setTypes).catch(() => {})
  }, [])

  function set(field, value)               { setForm(f => ({ ...f, [field]: value })) }
  function setNested(parent, field, value) { setForm(f => ({ ...f, [parent]: { ...f[parent], [field]: value } })) }

  function setPerson(listKey, idx, field, value) {
    setForm(f => {
      const list = f[listKey].map((p, i) => i === idx ? { ...p, [field]: value } : p)
      return { ...f, [listKey]: list }
    })
  }
  function addPerson(listKey) {
    setForm(f => ({ ...f, [listKey]: [...f[listKey], { ...EMPTY_PERSON }] }))
  }
  function removePerson(listKey, idx) {
    setForm(f => ({ ...f, [listKey]: f[listKey].filter((_, i) => i !== idx) }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = {
        ...form,
        contacts:         form.contacts.filter(p => p.name || p.phone || p.email),
        internalManagers: form.internalManagers.filter(p => p.name || p.phone || p.email),
      }
      let result
      if (isEdit) {
        result = await updateClient(client._id, payload)
        toast.success('Client mis à jour.')
      } else {
        result = await createClient(payload)
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

          <div className="form-group">
            <div className="form-label-row">
              <div className="form-section-title" style={{ margin: 0 }}>Contacts</div>
              <button type="button" className="add-field-btn" onClick={() => addPerson('contacts')}>
                <Plus size={12} /> Ajouter un contact
              </button>
            </div>
            {form.contacts.length === 0 && (
              <p className="cd-empty-hint" style={{ margin: '4px 0 0' }}>Aucun contact.</p>
            )}
            {form.contacts.map((p, i) => (
              <div key={i} className="person-row">
                <input
                  className="form-input form-input--plain"
                  value={p.name}
                  onChange={e => setPerson('contacts', i, 'name', e.target.value)}
                  placeholder="Prénom Nom"
                />
                <input
                  className="form-input form-input--plain"
                  value={p.phone}
                  onChange={e => setPerson('contacts', i, 'phone', e.target.value)}
                  placeholder="+216 xx xxx xxx"
                />
                <input
                  className="form-input form-input--plain"
                  type="email"
                  value={p.email}
                  onChange={e => setPerson('contacts', i, 'email', e.target.value)}
                  placeholder="contact@entreprise.tn"
                />
                <button type="button" className="remove-field-btn" title="Retirer ce contact"
                  onClick={() => removePerson('contacts', i)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <div className="form-section-title" style={{ margin: 0 }}>Responsables internes</div>
              <button type="button" className="add-field-btn" onClick={() => addPerson('internalManagers')}>
                <Plus size={12} /> Ajouter un responsable
              </button>
            </div>
            {form.internalManagers.length === 0 && (
              <p className="cd-empty-hint" style={{ margin: '4px 0 0' }}>Aucun responsable interne.</p>
            )}
            {form.internalManagers.map((p, i) => (
              <div key={i} className="person-row">
                <input
                  className="form-input form-input--plain"
                  value={p.name}
                  onChange={e => setPerson('internalManagers', i, 'name', e.target.value)}
                  placeholder="Prénom Nom"
                />
                <input
                  className="form-input form-input--plain"
                  value={p.phone}
                  onChange={e => setPerson('internalManagers', i, 'phone', e.target.value)}
                  placeholder="+216 xx xxx xxx"
                />
                <input
                  className="form-input form-input--plain"
                  type="email"
                  value={p.email}
                  onChange={e => setPerson('internalManagers', i, 'email', e.target.value)}
                  placeholder="responsable@cardiolife.tn"
                />
                <button type="button" className="remove-field-btn" title="Retirer ce responsable"
                  onClick={() => removePerson('internalManagers', i)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
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
