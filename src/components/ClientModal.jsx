import { useState } from 'react'
import { X, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'react-toastify'
import { createClient, updateClient } from '../api/clients'

const EMPTY_PERSON = { name: '', phone: '', email: '' }

function hydratePersons(list) {
  if (!list?.length) return []
  return list.map(p => ({ name: p.name || '', phone: p.phone || '', email: p.email || '' }))
}

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/**
 * Modal client.
 *  - Création : seul le nom est demandé. Tout le reste (adresse, contacts,
 *    notes) se renseigne ensuite depuis la fiche client.
 *  - Édition : formulaire complet.
 *
 * Props :
 *  client   - client existant (null → création)
 *  onClose  - () => void
 *  onSaved  - (client) => void
 */
export default function ClientModal({ client, onClose, onSaved }) {
  const isEdit = !!client?._id

  const [form, setForm] = useState({
    name:  client?.name  || '',
    notes: client?.notes || '',
    address: {
      street: client?.address?.street || '',
      city:   client?.address?.city   || '',
    },
    contacts:         hydratePersons(client?.contacts),
    internalManagers: hydratePersons(client?.internalManagers),
  })

  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  function set(field, value)               { setForm(f => ({ ...f, [field]: value })) }
  function setNested(parent, field, value) { setForm(f => ({ ...f, [parent]: { ...f[parent], [field]: value } })) }

  function setPerson(listKey, idx, field, value) {
    setForm(f => ({ ...f, [listKey]: f[listKey].map((p, i) => i === idx ? { ...p, [field]: value } : p) }))
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
      let result
      if (isEdit) {
        const payload = {
          ...form,
          contacts:         form.contacts.filter(p => p.name || p.phone || p.email),
          internalManagers: form.internalManagers.filter(p => p.name || p.phone || p.email),
        }
        result = await updateClient(client._id, payload)
        toast.success('Client mis à jour.')
      } else {
        result = await createClient({ name: form.name })
        toast.success('Client créé avec succès.')
      }
      onSaved(result)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  function renderPersonList(listKey, title, addLabel, emptyLabel, emailPlaceholder) {
    return (
      <div className="form-group">
        <div className="form-label-row">
          <div className="form-section-title" style={{ margin: 0 }}>{title}</div>
          <button type="button" className="add-field-btn" onClick={() => addPerson(listKey)}>
            <Plus size={12} /> {addLabel}
          </button>
        </div>
        {form[listKey].length === 0 && (
          <p className="cd-empty-hint" style={{ margin: '4px 0 0' }}>{emptyLabel}</p>
        )}
        {form[listKey].map((p, i) => (
          <div key={i} className="person-row">
            <input
              className="form-input form-input--plain"
              value={p.name}
              onChange={e => setPerson(listKey, i, 'name', e.target.value)}
              placeholder="Prénom Nom"
            />
            <input
              className="form-input form-input--plain"
              value={p.phone}
              onChange={e => setPerson(listKey, i, 'phone', e.target.value)}
              placeholder="+216 xx xxx xxx"
            />
            <input
              className="form-input form-input--plain"
              type="email"
              value={p.email}
              onChange={e => setPerson(listKey, i, 'email', e.target.value)}
              placeholder={emailPlaceholder}
            />
            <button type="button" className="remove-field-btn" title="Retirer"
              onClick={() => removePerson(listKey, i)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal${isEdit ? '' : ' modal--sm'}`}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Modifier le client' : 'Nouveau client'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">

          <div className="form-group">
            <label className="form-label">Nom du client *</label>
            <input
              className="form-input form-input--plain"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Ex : Hôtel X"
              autoFocus
              required
            />
            {!isEdit && (
              <p className="cd-empty-hint" style={{ padding: '6px 0 0' }}>
                Les sites, responsables et DEA se renseignent depuis la fiche client.
              </p>
            )}
          </div>

          {isEdit && (
            <>
              <div className="form-section-title">Adresse</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Adresse</label>
                  <input className="form-input form-input--plain" value={form.address.street}
                    onChange={e => setNested('address', 'street', e.target.value)}
                    placeholder="Ex : 12 Av. Habib Bourguiba" />
                </div>
                <div className="form-group">
                  <label className="form-label">Ville</label>
                  <input className="form-input form-input--plain" value={form.address.city}
                    onChange={e => setNested('address', 'city', e.target.value)} placeholder="Ex : Sfax" />
                </div>
              </div>

              {renderPersonList('contacts', 'Contacts', 'Ajouter un contact',
                'Aucun contact.', 'contact@entreprise.tn')}

              {renderPersonList('internalManagers', 'Responsables internes', 'Ajouter un responsable',
                'Aucun responsable interne.', 'responsable@cardiolife.tn')}

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input form-input--plain form-textarea" value={form.notes}
                  onChange={e => set('notes', e.target.value)} placeholder="Informations complémentaires…" rows={3} />
              </div>
            </>
          )}

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
