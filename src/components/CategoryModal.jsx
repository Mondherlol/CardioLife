import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { toast } from 'react-toastify'
import { createProductCategory, updateProductCategory } from '../api/productCategories'
import { CATEGORY_ICON_NAMES, CATEGORY_COLORS, categoryIcon } from '../constants/categoryIcons'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

/**
 * Création / édition d'une catégorie de produits.
 * Props : category (null → création), onClose, onSaved
 */
export default function CategoryModal({ category, onClose, onSaved }) {
  const isEdit = !!category?._id

  const [form, setForm] = useState({
    name:         category?.name        || '',
    icon:         category?.icon        || 'Package',
    color:        category?.color       || 'gray',
    image:        category?.image       || '',
    description:  category?.description || '',
    tracksSerial: category?.tracksSerial ?? false,
    tracksLot:    category?.tracksLot    ?? false,
    tracksItems:  category?.tracksItems  ?? false,
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = isEdit
        ? await updateProductCategory(category._id, form)
        : await createProductCategory(form)
      toast.success(isEdit ? 'Catégorie mise à jour.' : 'Catégorie créée.')
      onSaved(result)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  const PreviewIcon = categoryIcon(form.icon)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">

          {/* Aperçu de la carte telle qu'elle apparaîtra dans le stock */}
          <div className={`cat-card cat-card--${form.color} cat-card--preview`}>
            <PreviewIcon className="cat-card-ghost" size={132} strokeWidth={0.9} />
            <div className="cat-card-top">
              <span className="cat-card-media">
                {form.image
                  ? <img src={form.image} alt="" className="cat-card-img" />
                  : <PreviewIcon size={24} strokeWidth={1.9} />}
              </span>
            </div>
            <div className="cat-card-name">{form.name || 'Nom de la catégorie'}</div>
            <div className="cat-card-figures">
              <span className="cat-card-units">0</span>
              <span className="cat-card-units-label">article en stock</span>
            </div>
            <div className="cat-card-foot">
              <span className="cat-card-ref">0 référence</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Nom *</label>
            <input className="form-input form-input--plain" value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Ex : Défibrillateurs" autoFocus required />
            {isEdit && (
              <p className="form-hint">
                Identifiant technique : <code>{category.slug}</code> — figé pour ne pas détacher les produits.
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Icône</label>
            <div className="icon-picker">
              {CATEGORY_ICON_NAMES.map(name => {
                const Icon = categoryIcon(name)
                return (
                  <button
                    key={name} type="button" title={name}
                    className={`icon-picker-btn${form.icon === name ? ' icon-picker-btn--active' : ''}`}
                    onClick={() => set('icon', name)}
                  >
                    <Icon size={17} strokeWidth={1.7} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Couleur</label>
            <div className="color-picker">
              {CATEGORY_COLORS.map(c => (
                <button
                  key={c.value} type="button" title={c.label}
                  className={`color-picker-btn cat--${c.value}${form.color === c.value ? ' color-picker-btn--active' : ''}`}
                  onClick={() => set('color', c.value)}
                />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Image <span className="form-label-opt">(optionnelle)</span></label>
            <input className="form-input form-input--plain" value={form.image}
              onChange={e => set('image', e.target.value)}
              placeholder="https://…/defibrillateur.png" />
            <p className="form-hint">URL d'une illustration — elle remplace l'icône sur la carte.</p>
          </div>

          <div className="form-section-title">Traçabilité des produits de la catégorie</div>
          <div className="form-group">
            <label className="cat-track-row">
              <input type="checkbox" checked={form.tracksSerial}
                onChange={e => set('tracksSerial', e.target.checked)} />
              <span>
                <strong>Numéros de série</strong>
                <span className="cat-track-hint">Chaque article est suivi individuellement (défibrillateurs…).</span>
              </span>
            </label>
            <label className="cat-track-row">
              <input type="checkbox" checked={form.tracksLot}
                onChange={e => set('tracksLot', e.target.checked)} />
              <span>
                <strong>Numéros de lot et péremption</strong>
                <span className="cat-track-hint">
                  Active les indicateurs « Expirent bientôt » et « Expirés » et le filtre par date.
                </span>
              </span>
            </label>
          </div>

          <div className="form-section-title">Affichage dans le stock</div>
          <div className="form-group">
            <label className="cat-track-row">
              <input type="checkbox" checked={form.tracksItems}
                onChange={e => set('tracksItems', e.target.checked)} />
              <span>
                <strong>Vue par modèles</strong>
                <span className="cat-track-hint">
                  La catégorie s'ouvre sur la liste de ses modèles avec leurs compteurs
                  (total, disponible, réservé, en maintenance) au lieu de la grille de tuiles.
                  Le détail article par article reste accessible dans les deux cas.
                </span>
              </span>
            </label>
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : isEdit ? 'Enregistrer' : 'Créer la catégorie'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
