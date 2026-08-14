import { useState, useEffect, useRef } from 'react'
import { X, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'react-toastify'
import { createSite, updateSite } from '../api/sites'

const EMPTY_CONTACT = { name: '', role: '', phone: '', email: '' }

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/**
 * Création / édition d'un site client.
 * Props :
 *  clientId - id du client propriétaire (requis en création)
 *  site     - site existant (null → création)
 *  focus    - 'contacts' pour ouvrir directement sur les responsables
 *  onClose  - () => void
 *  onSaved  - (site) => void
 */
export default function SiteModal({ clientId, site, focus, onClose, onSaved }) {
  const isEdit = !!site?._id
  const contactsRef = useRef(null)

  const [form, setForm] = useState({
    name:    site?.name || '',
    notes:   site?.notes || '',
    address: {
      street: site?.address?.street || '',
      city:   site?.address?.city   || '',
    },
    // Ouvert depuis « Responsable » : une ligne vierge est prête à la saisie.
    contacts: site?.contacts?.length
      ? [
          ...site.contacts.map(c => ({ name: c.name || '', role: c.role || '', phone: c.phone || '', email: c.email || '' })),
          ...(focus === 'contacts' ? [{ ...EMPTY_CONTACT }] : []),
        ]
      : [{ ...EMPTY_CONTACT }],
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (focus !== 'contacts') return
    const node = contactsRef.current
    if (!node) return
    node.scrollIntoView({ block: 'nearest' })
    node.querySelector('.person-row:last-child input')?.focus()
  }, [focus])

  function set(field, value)          { setForm(f => ({ ...f, [field]: value })) }
  function setAddress(field, value)   { setForm(f => ({ ...f, address: { ...f.address, [field]: value } })) }
  function setContact(idx, field, value) {
    setForm(f => ({ ...f, contacts: f.contacts.map((c, i) => i === idx ? { ...c, [field]: value } : c) }))
  }
  function addContact()      { setForm(f => ({ ...f, contacts: [...f.contacts, { ...EMPTY_CONTACT }] })) }
  function removeContact(idx) { setForm(f => ({ ...f, contacts: f.contacts.filter((_, i) => i !== idx) })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = {
        ...form,
        contacts: form.contacts.filter(c => c.name || c.phone || c.email),
      }
      const result = isEdit
        ? await updateSite(site._id, payload)
        : await createSite({ ...payload, client: clientId })
      toast.success(isEdit ? 'Site mis à jour.' : 'Site ajouté.')
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
          <h2 className="modal-title">{isEdit ? 'Modifier le site' : 'Nouveau site'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">

          <div className="form-group">
            <label className="form-label">Nom du site *</label>
            <input
              className="form-input form-input--plain"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Ex : Hôtel X Hammamet"
              autoFocus={focus !== 'contacts'}
              required
            />
          </div>

          <div className="form-group" ref={contactsRef}>
            <div className="form-label-row">
              <div className="form-section-title" style={{ margin: 0 }}>Responsables</div>
              <button type="button" className="add-field-btn" onClick={addContact}>
                <Plus size={12} /> Ajouter un responsable
              </button>
            </div>
            {form.contacts.length === 0 && (
              <p className="cd-empty-hint" style={{ margin: '4px 0 0' }}>Aucun responsable.</p>
            )}
            {form.contacts.map((c, i) => (
              <div key={i} className="person-row">
                <input
                  className="form-input form-input--plain"
                  value={c.name}
                  onChange={e => setContact(i, 'name', e.target.value)}
                  placeholder="Prénom Nom"
                />
                <input
                  className="form-input form-input--plain"
                  value={c.phone}
                  onChange={e => setContact(i, 'phone', e.target.value)}
                  placeholder="+216 xx xxx xxx"
                />
                <input
                  className="form-input form-input--plain"
                  type="email"
                  value={c.email}
                  onChange={e => setContact(i, 'email', e.target.value)}
                  placeholder="responsable@site.tn"
                />
                <button type="button" className="remove-field-btn" title="Retirer ce responsable"
                  onClick={() => removeContact(i)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="form-section-title">Adresse</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Adresse</label>
              <input className="form-input form-input--plain" value={form.address.street}
                onChange={e => setAddress('street', e.target.value)} placeholder="Ex : 12 Av. Habib Bourguiba" />
            </div>
            <div className="form-group">
              <label className="form-label">Ville</label>
              <input className="form-input form-input--plain" value={form.address.city}
                onChange={e => setAddress('city', e.target.value)} placeholder="Ex : Sfax" />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input form-input--plain form-textarea" value={form.notes}
              onChange={e => set('notes', e.target.value)} placeholder="Informations complémentaires…" rows={2} />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Ajouter le site'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
