import { useState, useEffect, useCallback } from 'react'
import {
  Monitor, Users, MoreHorizontal, Plus, Pencil, Trash2,
  KeyRound, Power, X, Eye, EyeOff, ShieldOff,
  CheckCircle2, AlertTriangle, HardDrive, Save, Boxes,
  ChevronUp, ChevronDown, Wrench, Building2, Upload, RotateCcw,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import {
  isAdmin, defaultPermissionsForRole, ROLE_PERMISSION_PRESETS, PERMISSION_KEYS,
} from '../lib/access'
import { PASSWORD_MIN_LENGTH } from '../constants/auth'
import {
  getUsers, createUser, updateUser, resetUserPassword, deleteUser,
} from '../api/users'
import {
  getAppSettings, updateAppSettings, resetDatabase,
  uploadCompanyLogo, deleteCompanyLogo, companyLogoUrl,
} from '../api/appSettings'
import { getFolderTree } from '../api/documents'
import {
  getProductCategories, deleteProductCategory, reorderProductCategories,
} from '../api/productCategories'
import { categoryIcon } from '../constants/categoryIcons'
import CategoryModal from '../components/CategoryModal'
import DevFixPanel from '../components/DevFixPanel'

/* ─── Constants ─────────────────────────────────────────────── */

const TABS = [
  { id: 'systeme',       label: 'Système',            icon: Monitor },
  { id: 'societe',       label: 'Société',            icon: Building2 },
  { id: 'utilisateurs',  label: 'Utilisateurs',       icon: Users },
  { id: 'categories',    label: 'Catégories produits', icon: Boxes },
  { id: 'autres',        label: 'Autres',             icon: MoreHorizontal },
  // Reprises de données : elles réécrivent du métier, l'onglet n'apparaît
  // même pas pour les autres rôles.
  { id: 'devfix',        label: 'Dev Fix',            icon: Wrench, superAdminOnly: true },
]

const ROLES = ['admin', 'technicien', 'commercial', 'assistante', 'readonly']
const ALL_ROLES = ['superadmin', ...ROLES]

const ROLE_LABELS = {
  superadmin: 'Super Admin',
  admin:      'Admin',
  technicien: 'Technicien',
  commercial: 'Commercial',
  assistante: 'Assistante',
  readonly:   'Lecture seule',
}

/* Liste tenue dans `src/lib/access.js` : une case déclarée ici mais absente
   là-bas serait un droit sans effet — c'est ce qui est arrivé à
   `canManageUsers` et `canViewReports`. */
const PERM_KEYS = PERMISSION_KEYS

const PERM_LABELS = {
  canManageClients:       'Gérer les clients',
  canManageDevices:       'Gérer les appareils',
  canManageContracts:     'Gérer les contrats',
  canViewStock:           'Consulter le stock',
  canManageStock:         'Gérer le stock',
  canManageInterventions: 'Gérer les interventions',
  canManageUsers:         'Gérer les utilisateurs',
  canViewReports:         'Voir les rapports',
  canManageFormations:    'Gérer les formations',
}

/* Ce que chaque case ouvre réellement — l'énoncé doit correspondre aux tableaux
   de `src/lib/access.js` et `backend/middleware/access.js`. */
const PERM_HINTS = {
  canManageClients:       'Menu Clients, sites et DEA, onglet Formations, Documents',
  canManageDevices:       'Onglets Installations et Remplacements de la Maintenance',
  canManageContracts:     'Menu Contrats',
  canViewStock:           'Voir le catalogue et les articles, sans rien modifier',
  canManageStock:         'Modifier le stock, les packs et les mouvements',
  canManageInterventions: 'Onglets Contrôles et Remplacements de la Maintenance',
  canManageUsers:         'Menu Paramètres et gestion des utilisateurs',
  canViewReports:         'Tableau de bord et Documents',
  canManageFormations:    'Onglet Formations de la Maintenance',
}

const EMPTY_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]))

const EMPTY_FORM = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  role: 'readonly',
  permissions: defaultPermissionsForRole('readonly'),
}

/* ─── Helpers ───────────────────────────────────────────────── */

function initials(name) {
  if (!name) return '??'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function RoleBadge({ role }) {
  return <span className={`user-role-badge user-role-badge--${role}`}>{ROLE_LABELS[role] ?? role}</span>
}

function StatusPill({ active }) {
  return (
    <span className={`status-pill status-pill--${active ? 'active' : 'inactive'}`}>
      {active ? 'Actif' : 'Désactivé'}
    </span>
  )
}

/* ─── User Form Modal (create + edit) ───────────────────────── */

function UserModal({ mode, initial, currentUser, onClose, onSave }) {
  const [form, setForm]       = useState(initial ?? { ...EMPTY_FORM })
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [errors, setErrors]   = useState({})
  const [presetApplied, setPresetApplied] = useState(false)

  const isSuperAdmin = currentUser.role === 'superadmin'

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  function setPerm(key, val) {
    setForm(f => ({ ...f, permissions: { ...f.permissions, [key]: val } }))
    setPresetApplied(false)
  }

  /**
   * Changer de rôle recoche les permissions par défaut du métier. Sans cela on
   * créait un technicien à zéro droit, qui n'ouvrait plus rien.
   */
  function setRole(role) {
    setForm(f => ({ ...f, role, permissions: defaultPermissionsForRole(role) }))
    setPresetApplied(!!ROLE_PERMISSION_PRESETS[role])
  }

  function validate() {
    const e = {}
    if (!form.fullName.trim())  e.fullName = 'Nom complet requis.'
    if (!form.username.trim())  e.username = 'Identifiant requis.'
    if (!form.email.trim())     e.email    = 'Email requis.'
    // Le mot de passe ne se saisit qu'à la création : ensuite il passe par
    // l'action « Réinitialiser le mot de passe » de la liste.
    if (mode === 'create' && form.password.length < PASSWORD_MIN_LENGTH) {
      e.password = `Minimum ${PASSWORD_MIN_LENGTH} caractères.`
    }
    return e
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      const payload = {
        fullName:    form.fullName.trim(),
        username:    form.username.trim().toLowerCase(),
        email:       form.email.trim().toLowerCase(),
        role:        form.role,
        permissions: form.permissions,
      }
      if (mode === 'create') payload.password = form.password
      await onSave(payload)
    } catch (err) {
      const msg = err.message || 'Erreur.'
      if (err.errors?.length) {
        const map = {}
        err.errors.forEach(e => { map[e.path] = e.msg })
        setErrors(map)
      } else {
        toast.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  // Super Admin et Admin ont accès à tout : afficher des cases décochées qui
  // n'ont aucun effet est ce qui a fait croire à des droits mal appliqués.
  const fullAccessRole = form.role === 'superadmin' || form.role === 'admin'
  const showPerms = form.role !== 'superadmin'
  const permDisabled = fullAccessRole

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--md">
        <div className="modal-header">
          <h2 className="modal-title">
            {mode === 'create' ? 'Nouvel utilisateur' : 'Modifier l\'utilisateur'}
          </h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nom complet</label>
                <input
                  className={`form-input form-input--plain${errors.fullName ? ' form-input--error' : ''}`}
                  value={form.fullName}
                  onChange={e => setField('fullName', e.target.value)}
                  placeholder="Jean Dupont"
                />
                {errors.fullName && <span className="form-error">{errors.fullName}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Identifiant</label>
                <input
                  className={`form-input form-input--plain${errors.username ? ' form-input--error' : ''}`}
                  value={form.username}
                  onChange={e => setField('username', e.target.value)}
                  placeholder="jean.dupont"
                />
                {errors.username && <span className="form-error">{errors.username}</span>}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className={`form-input form-input--plain${errors.email ? ' form-input--error' : ''}`}
                value={form.email}
                onChange={e => setField('email', e.target.value)}
                placeholder="jean@exemple.fr"
              />
              {errors.email && <span className="form-error">{errors.email}</span>}
            </div>

            {/* Uniquement à la création : la modification passe par l'action
                dédiée « Réinitialiser le mot de passe » de la liste. Ce champ
                était de toute façon sans effet en édition — l'API de mise à
                jour ne lit pas `password`. */}
            {mode === 'create' && (
              <div className="form-group">
                <label className="form-label">Mot de passe</label>
                <div className="input-with-icon">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className={`form-input form-input--plain${errors.password ? ' form-input--error' : ''}`}
                    value={form.password}
                    onChange={e => setField('password', e.target.value)}
                    placeholder="••••••••"
                  />
                  <button type="button" className="input-icon-btn" onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <span className="form-error">{errors.password}</span>}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Rôle</label>
              <select
                className="form-input form-input--plain"
                value={form.role}
                onChange={e => setRole(e.target.value)}
                disabled={!isSuperAdmin && form.role === 'superadmin'}
              >
                {(isSuperAdmin ? ALL_ROLES : ROLES).map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            {showPerms && (
              <div className="form-group">
                <label className="form-label">Permissions</label>
                {fullAccessRole ? (
                  <p className="form-hint">
                    Le rôle Administrateur donne accès à tous les modules ; ces cases
                    ne s'appliquent qu'aux autres rôles.
                  </p>
                ) : presetApplied && (
                  <p className="form-hint">
                    Droits par défaut du rôle « {ROLE_LABELS[form.role]} » appliqués —
                    ajustez-les si besoin.
                  </p>
                )}
                <div className="perm-grid">
                  {PERM_KEYS.map(key => (
                    <label key={key} className="perm-item">
                      <span>
                        {PERM_LABELS[key]}
                        <small className="perm-hint">{PERM_HINTS[key]}</small>
                      </span>
                      <span className="perm-toggle">
                        <input
                          type="checkbox"
                          checked={fullAccessRole ? true : !!form.permissions[key]}
                          disabled={permDisabled}
                          onChange={e => setPerm(key, e.target.checked)}
                        />
                        <span className="perm-toggle-track" />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : null}
              {mode === 'create' ? 'Créer' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Reset Password Modal ──────────────────────────────────── */

function ResetPasswordModal({ user, onClose, onSave }) {
  const [pwd, setPwd]       = useState('')
  const [show, setShow]     = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (pwd.length < PASSWORD_MIN_LENGTH) {
      setError(`Minimum ${PASSWORD_MIN_LENGTH} caractères.`); return
    }
    setSaving(true)
    try {
      await onSave(pwd)
    } catch (err) {
      toast.error(err.message || 'Erreur.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Réinitialiser le mot de passe</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-subtitle">
              Nouveau mot de passe pour <strong>{user.fullName}</strong>
            </p>
            <div className="form-group">
              <div className="input-with-icon">
                <input
                  type={show ? 'text' : 'password'}
                  className={`form-input form-input--plain${error ? ' form-input--error' : ''}`}
                  value={pwd}
                  onChange={e => { setPwd(e.target.value); setError('') }}
                  placeholder="Nouveau mot de passe"
                  autoFocus
                />
                <button type="button" className="input-icon-btn" onClick={() => setShow(v => !v)}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && <span className="form-error">{error}</span>}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : null}
              Réinitialiser
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Delete Confirm Modal ──────────────────────────────────── */

function DeleteModal({ user, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    try {
      await onConfirm()
    } catch (err) {
      toast.error(err.message || 'Erreur.')
      setDeleting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Supprimer l'utilisateur</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="delete-confirm-body">
            <div className="delete-confirm-icon">
              <AlertTriangle size={28} />
            </div>
            <p>
              Voulez-vous vraiment supprimer le compte de <strong>{user.fullName}</strong> ?<br />
              <span className="text-muted">Cette action est irréversible.</span>
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--danger" onClick={handleConfirm} disabled={deleting}>
            {deleting ? <span className="spinner spinner--sm" /> : null}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Utilisateurs Tab ──────────────────────────────────────── */

function UtilisateursTab({ currentUser }) {
  // `canManageUsers` restait décoratif : l'onglet ne regardait que le rôle.
  const canManage = isAdmin(currentUser) || !!currentUser.permissions?.canManageUsers

  const [users, setUsers]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [toggling, setToggling]     = useState(null)

  const fetchUsers = useCallback(async () => {
    try {
      const data = await getUsers()
      setUsers(data)
    } catch (err) {
      toast.error(err.message || 'Impossible de charger les utilisateurs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  if (!canManage) {
    return (
      <div className="sp-access-denied">
        <ShieldOff size={48} />
        <h3>Accès non autorisé</h3>
        <p>Seuls les admins peuvent accéder à la gestion des utilisateurs.</p>
      </div>
    )
  }

  function canActOn(target) {
    if (target._id === currentUser._id) return false
    if (currentUser.role === 'admin' && target.role === 'superadmin') return false
    return true
  }

  async function handleCreate(payload) {
    const created = await createUser(payload)
    toast.success('Utilisateur créé.')
    setUsers(prev => [created, ...prev])
    setCreateOpen(false)
  }

  async function handleEdit(payload) {
    const updated = await updateUser(editTarget._id, payload)
    toast.success('Utilisateur mis à jour.')
    setUsers(prev => prev.map(u => u._id === updated._id ? updated : u))
    setEditTarget(null)
  }

  async function handleToggleActive(u) {
    setToggling(u._id)
    try {
      const updated = await updateUser(u._id, { isActive: !u.isActive })
      setUsers(prev => prev.map(x => x._id === updated._id ? updated : x))
      toast.success(updated.isActive ? 'Compte activé.' : 'Compte désactivé.')
    } catch (err) {
      toast.error(err.message || 'Erreur.')
    } finally {
      setToggling(null)
    }
  }

  async function handleResetPassword(pwd) {
    await resetUserPassword(resetTarget._id, pwd)
    toast.success('Mot de passe réinitialisé.')
    setResetTarget(null)
  }

  async function handleDelete() {
    await deleteUser(deleteTarget._id)
    toast.success('Utilisateur supprimé.')
    setUsers(prev => prev.filter(u => u._id !== deleteTarget._id))
    setDeleteTarget(null)
  }

  const editInitial = editTarget ? {
    fullName:    editTarget.fullName,
    username:    editTarget.username,
    email:       editTarget.email,
    password:    '',
    role:        editTarget.role,
    permissions: { ...EMPTY_PERMS, ...editTarget.permissions },
  } : null

  return (
    <>
      <div className="sp-users-header">
        <div>
          <h2 className="sp-section-title">Utilisateurs</h2>
          <p className="sp-section-desc">{users.length} compte{users.length !== 1 ? 's' : ''} enregistré{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
          <Plus size={15} /> Nouvel utilisateur
        </button>
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th style={{ width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const actable = canActOn(u)
                const isMe = u._id === currentUser._id
                return (
                  <tr key={u._id} className={!u.isActive ? 'table-row--inactive' : ''}>
                    <td>
                      <div className="user-name-cell">
                        <div className={`user-avatar${!u.isActive ? ' user-avatar--inactive' : ''}`}>
                          {initials(u.fullName)}
                        </div>
                        <div>
                          <div className="user-name-main">
                            {u.fullName}
                            {isMe && <span className="sp-you-badge"> (moi)</span>}
                          </div>
                          <div className="user-name-sub">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-muted">{u.email}</td>
                    <td><RoleBadge role={u.role} /></td>
                    <td><StatusPill active={u.isActive} /></td>
                    <td>
                      <div className="sp-actions">
                        <button
                          className="sp-action-btn"
                          title="Modifier"
                          disabled={!actable}
                          onClick={() => setEditTarget(u)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="sp-action-btn"
                          title="Réinitialiser le mot de passe"
                          disabled={!actable}
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          className={`sp-action-btn${u.isActive ? '' : ' sp-action-btn--success'}`}
                          title={u.isActive ? 'Désactiver' : 'Activer'}
                          disabled={!actable || toggling === u._id}
                          onClick={() => handleToggleActive(u)}
                        >
                          {toggling === u._id
                            ? <span className="spinner spinner--sm" />
                            : u.isActive
                              ? <Power size={14} />
                              : <CheckCircle2 size={14} />
                          }
                        </button>
                        <button
                          className="sp-action-btn sp-action-btn--danger"
                          title="Supprimer"
                          disabled={!actable}
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && (
                <tr><td colSpan={5} className="table-empty">Aucun utilisateur trouvé.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <UserModal
          mode="create"
          currentUser={currentUser}
          onClose={() => setCreateOpen(false)}
          onSave={handleCreate}
        />
      )}
      {editTarget && (
        <UserModal
          mode="edit"
          initial={editInitial}
          currentUser={currentUser}
          onClose={() => setEditTarget(null)}
          onSave={handleEdit}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSave={handleResetPassword}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}

/* ─── Placeholder Tabs ──────────────────────────────────────── */

function SystemeTab() {
  const [settings,  setSettings]  = useState(null)
  const [folders,   setFolders]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    Promise.all([getAppSettings(), getFolderTree().catch(() => [])])
      .then(([s, tree]) => { setSettings(s); setFolders(tree) })
      .catch(() => toast.error('Impossible de charger les paramètres.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await updateAppSettings(settings)
      toast.success('Paramètres sauvegardés.')
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="table-loading"><span className="spinner" /></div>
  if (!settings) return null

  const usedMB  = settings.usedBytes ? (settings.usedBytes / 1024 / 1024).toFixed(1) : 0
  const usedPct = settings.maxTotalSpaceMB
    ? Math.min(100, Math.round((usedMB / settings.maxTotalSpaceMB) * 100))
    : 0

  return (
    <>
      <h2 className="sp-section-title">Système</h2>
      <p className="sp-section-desc">Configuration du stockage et des uploads de documents.</p>

      <div className="settings-group">
        <div className="settings-group-title"><HardDrive size={15} /> Stockage des documents</div>

        <div className="form-row" style={{ marginTop: 16 }}>
          <div className="form-group">
            <label className="form-label">Taille max. par fichier (Mo)</label>
            <input
              type="number" min={1} max={2048}
              className="form-input form-input--plain"
              value={settings.maxFileSizeMB}
              onChange={e => setSettings(s => ({ ...s, maxFileSizeMB: +e.target.value }))}
            />
            <span className="form-hint">Limite appliquée à chaque fichier uploadé</span>
          </div>
          <div className="form-group">
            <label className="form-label">Espace total max. (Mo)</label>
            <input
              type="number" min={1}
              className="form-input form-input--plain"
              value={settings.maxTotalSpaceMB}
              onChange={e => setSettings(s => ({ ...s, maxTotalSpaceMB: +e.target.value }))}
            />
            <span className="form-hint">Limite globale pour tous les fichiers</span>
          </div>
        </div>

        <div className="form-group" style={{ maxWidth: '50%' }}>
          <label className="form-label">Dossier d'upload par défaut</label>
          <select
            className="form-input form-input--plain"
            value={settings.defaultUploadFolderId || ''}
            onChange={e => setSettings(s => ({ ...s, defaultUploadFolderId: e.target.value || null }))}
          >
            <option value="">Racine</option>
            {folders.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
          </select>
          <span className="form-hint">Les nouveaux fichiers uploadés iront dans ce dossier par défaut</span>
        </div>

        <button className="btn btn--primary" style={{ marginTop: 20 }} onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner spinner--sm" /> : <Save size={14} />}
          Enregistrer les paramètres
        </button>
      </div>
    </>
  )
}

/* ─── Société ───────────────────────────────────────────────────
   L'en-tête du papier à lettres, saisi une fois. Le bon d'intervention le lit
   à l'impression : changer d'adresse ne doit pas demander de toucher au code. */

const COMPANY_FIELDS = [
  { key: 'name',    label: "Nom de la société", hint: 'Affiché sous le logo et en pied de document' },
  { key: 'taxId',   label: 'Matricule fiscal',  hint: 'Imprimé sous la date du bon (MF)' },
  { key: 'address', label: 'Adresse', rows: 2, hint: 'Une ligne par retour à la ligne' },
  { key: 'city',    label: 'CP / Ville' },
  { key: 'phone',   label: 'Téléphone', rows: 2, hint: 'Plusieurs numéros : un par ligne' },
  { key: 'email',   label: 'E-mail' },
  { key: 'website', label: 'Site web' },
  { key: 'footer',  label: 'Pied de page des documents', rows: 3, full: true,
    hint: "Bureau, matricule fiscal, coordonnées bancaires — bas du bon d'intervention" },
]

function SocieteTab() {
  const [settings, setSettings] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [busyLogo, setBusyLogo] = useState(false)

  useEffect(() => {
    getAppSettings()
      .then(setSettings)
      .catch(() => toast.error('Impossible de charger les paramètres.'))
      .finally(() => setLoading(false))
  }, [])

  const company = settings?.company || {}

  function setField(key, value) {
    setSettings(s => ({ ...s, company: { ...s.company, [key]: value } }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const saved = await updateAppSettings({ company: settings.company })
      setSettings(saved)
      toast.success('Informations de société enregistrées.')
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusyLogo(true)
    try {
      setSettings(await uploadCompanyLogo(file))
      toast.success('Logo mis à jour.')
    } catch (err) {
      toast.error(err.message || 'Envoi impossible.')
    } finally {
      setBusyLogo(false)
    }
  }

  async function handleResetLogo() {
    setBusyLogo(true)
    try {
      setSettings(await deleteCompanyLogo())
      toast.success('Logo par défaut rétabli.')
    } catch (err) {
      toast.error(err.message || 'Suppression impossible.')
    } finally {
      setBusyLogo(false)
    }
  }

  if (loading)   return <div className="table-loading"><span className="spinner" /></div>
  if (!settings) return null

  return (
    <>
      <h2 className="sp-section-title">Société</h2>
      <p className="sp-section-desc">
        Identité imprimée en tête et en pied des documents — bon d'intervention en premier lieu.
      </p>

      <div className="settings-group">
        <div className="settings-group-title"><Building2 size={15} /> Logo</div>

        <div className="sp-logo-row">
          <div className="sp-logo-preview">
            <img src={companyLogoUrl(company.logo)} alt={company.name || 'Logo'} />
          </div>
          <div className="sp-logo-actions">
            <label className="btn btn--ghost" style={busyLogo ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
              <Upload size={14} /> Changer le logo
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden disabled={busyLogo} onChange={handleLogo} />
            </label>
            {company.logo && (
              <button className="btn btn--ghost" disabled={busyLogo} onClick={handleResetLogo}>
                <RotateCcw size={14} /> Logo par défaut
              </button>
            )}
            <span className="form-hint">
              PNG, JPEG, WebP ou SVG — 3 Mo maximum. Fond blanc de préférence :
              le logo s'imprime tel quel.
            </span>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Building2 size={15} /> Coordonnées</div>

        <div className="sp-company-grid">
          {COMPANY_FIELDS.map(f => (
            <div key={f.key} className={`form-group${f.full ? ' sp-company-full' : ''}`}>
              <label className="form-label">{f.label}</label>
              {f.rows ? (
                <textarea className="form-input form-input--plain" rows={f.rows}
                  value={company[f.key] || ''}
                  onChange={e => setField(f.key, e.target.value)} />
              ) : (
                <input className="form-input form-input--plain"
                  value={company[f.key] || ''}
                  onChange={e => setField(f.key, e.target.value)} />
              )}
              {f.hint && <span className="form-hint">{f.hint}</span>}
            </div>
          ))}
        </div>

        <button className="btn btn--primary" style={{ marginTop: 20 }}
          onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner spinner--sm" /> : <Save size={14} />}
          Enregistrer les informations
        </button>
      </div>
    </>
  )
}

/* ─── Catégories produits ───────────────────────────────────── */

function CategoriesTab() {
  const [categories, setCategories] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)   // null | 'create' | category
  const [deleting,   setDeleting]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getProductCategories({ withStats: 'true' })
      setCategories(Array.isArray(data) ? data : [])
    } catch (err) {
      toast.error(err.message || 'Chargement impossible.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  /* L'ordre défini ici est celui des cartes sur la page Stock. */
  async function move(index, delta) {
    const next = [...categories]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setCategories(next)
    try {
      await reorderProductCategories(next.map(c => c._id))
    } catch (err) {
      toast.error(err.message || 'Réordonnancement impossible.')
      load()
    }
  }

  async function confirmDelete() {
    try {
      await deleteProductCategory(deleting._id)
      toast.success('Catégorie supprimée.')
      setDeleting(null)
      load()
    } catch (err) {
      toast.error(err.message || 'Suppression impossible.')
    }
  }

  return (
    <>
      <div className="sp-section-head">
        <div>
          <h2 className="sp-section-title">Catégories produits</h2>
          <p className="sp-section-desc">
            Nom, icône, couleur et traçabilité des catégories affichées sur la page Stock.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setModal('create')}>
          <Plus size={15} /> Nouvelle catégorie
        </button>
      </div>

      {loading ? (
        <div className="table-loading"><span className="spinner" /></div>
      ) : (
        <div className="cat-settings-list">
          {categories.map((c, i) => {
            const Icon = categoryIcon(c.icon)
            return (
              <div key={c._id} className="cat-settings-row">
                <div className="cat-settings-order">
                  <button className="cat-order-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Monter">
                    <ChevronUp size={13} />
                  </button>
                  <button className="cat-order-btn" disabled={i === categories.length - 1} onClick={() => move(i, 1)} title="Descendre">
                    <ChevronDown size={13} />
                  </button>
                </div>

                <span className={`cat-settings-icon cat--${c.color}`}>
                  {c.image ? <img src={c.image} alt="" /> : <Icon size={18} strokeWidth={1.7} />}
                </span>

                <div className="cat-settings-body">
                  <div className="cat-settings-name">{c.name}</div>
                  <div className="cat-settings-meta">
                    <code>{c.slug}</code>
                    <span>{c.stats?.products ?? 0} produit{(c.stats?.products ?? 0) !== 1 ? 's' : ''}</span>
                    {c.tracksSerial && <span className="track-badge">N° série</span>}
                    {c.tracksLot    && <span className="track-badge track-badge--lot">N° lot</span>}
                  </div>
                </div>

                <div className="row-actions">
                  <button className="action-btn action-btn--edit" title="Modifier" onClick={() => setModal(c)}>
                    <Pencil size={14} />
                  </button>
                  <button className="action-btn action-btn--delete" title="Supprimer" onClick={() => setDeleting(c)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
          {categories.length === 0 && (
            <div className="sp-placeholder">
              <Boxes size={40} strokeWidth={1.2} />
              <p style={{ marginTop: 12 }}>Aucune catégorie configurée.</p>
            </div>
          )}
        </div>
      )}

      {modal && (
        <CategoryModal
          category={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

      {deleting && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDeleting(null)}>
          <div className="modal modal--sm">
            <div className="modal-header">
              <h2 className="modal-title">Supprimer la catégorie</h2>
              <button className="modal-close" onClick={() => setDeleting(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="delete-confirm-text">
                Supprimer <strong>{deleting.name}</strong> ? La suppression est refusée tant que des
                produits y sont rattachés.
              </p>
              <div className="modal-footer">
                <button className="btn btn--ghost" onClick={() => setDeleting(null)}>Annuler</button>
                <button className="btn btn--danger" onClick={confirmDelete}>Supprimer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ─── Réinitialisation de la base ───────────────────────────── */

const RESET_PHRASE = 'REINITIALISER'

/**
 * Le geste est irréversible : il demande la phrase exacte, énumère ce qui va
 * disparaître, et rappelle ce qui survit. Un simple « Êtes-vous sûr ? » ne
 * suffirait pas pour une action de cette portée.
 */
function ResetDbModal({ onClose, onDone }) {
  const [phrase,  setPhrase]  = useState('')
  const [keepFiles, setKeepFiles] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const armed = phrase.trim().toUpperCase() === RESET_PHRASE

  async function confirm() {
    setLoading(true)
    setError('')
    try {
      const res = await resetDatabase({ confirm: RESET_PHRASE, keepFiles })
      const total = Object.values(res.deleted || {}).reduce((n, v) => n + v, 0)
      toast.success(`Base réinitialisée — ${total} enregistrement${total > 1 ? 's' : ''} supprimé${total > 1 ? 's' : ''}.`)
      onDone()
    } catch (err) {
      setError(err.message || 'La réinitialisation a échoué.')
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title"><AlertTriangle size={16} /> Réinitialiser la base</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Toutes les données saisies seront <strong>définitivement supprimées</strong> :
            clients, sites et parc DAE, contrats, contrôles et fiches, formations,
            remplacements, planning, stock, produits et documents.
          </p>

          <div className="sp-reset-keep">
            <CheckCircle2 size={13} />
            <span>Les <strong>comptes utilisateurs</strong> et les réglages de
            l'application sont conservés.</span>
          </div>

          <label className="sp-reset-opt">
            <input type="checkbox" checked={keepFiles}
              onChange={e => setKeepFiles(e.target.checked)} />
            <span>Conserver les fichiers déjà téléversés (photos, documents, logos).
              Sans cette option, ils sont effacés du serveur — plus rien ne les
              désignerait.</span>
          </label>

          <div className="form-group">
            <label className="form-label">
              Tapez <strong>{RESET_PHRASE}</strong> pour confirmer
            </label>
            <input className="form-input form-input--plain" value={phrase}
              onChange={e => setPhrase(e.target.value)}
              placeholder={RESET_PHRASE} autoFocus autoComplete="off" />
          </div>

          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}

          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={confirm} disabled={!armed || loading}>
              {loading ? <span className="login-btn-spinner" /> : <><Trash2 size={14} /> Tout effacer</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AutresTab({ currentUser }) {
  const [resetOpen, setResetOpen] = useState(false)
  const isSuper = currentUser?.role === 'superadmin'

  return (
    <>
      <h2 className="sp-section-title">Autres</h2>
      <p className="sp-section-desc">Paramètres divers.</p>

      {isSuper ? (
        <div className="sp-danger">
          <div className="sp-danger-head">
            <ShieldOff size={16} />
            <div>
              <h3 className="sp-danger-title">Zone dangereuse</h3>
              <p className="sp-danger-desc">
                Réservé au Super Admin. Ces actions ne se défont pas.
              </p>
            </div>
          </div>

          <div className="sp-danger-row">
            <div className="sp-danger-row-text">
              <strong>Réinitialiser la base</strong>
              <span>
                Efface toutes les données métier — clients, parc, contrats, contrôles,
                formations, stock, documents. Les comptes utilisateurs sont conservés.
              </span>
            </div>
            <button className="btn btn--danger" onClick={() => setResetOpen(true)}>
              <Trash2 size={14} /> Réinitialiser
            </button>
          </div>
        </div>
      ) : (
        <div className="sp-placeholder">
          <MoreHorizontal size={40} strokeWidth={1.2} />
          <p style={{ marginTop: 12 }}>Aucun paramètre disponible pour l'instant.</p>
        </div>
      )}

      {resetOpen && (
        <ResetDbModal
          onClose={() => setResetOpen(false)}
          // Tout ce qui est en mémoire dans l'application vient d'être effacé :
          // on repart d'une page propre plutôt que d'écrans qui mentent.
          onDone={() => { setResetOpen(false); window.location.assign('/dashboard') }}
        />
      )}
    </>
  )
}

/* ─── Main Page ─────────────────────────────────────────────── */

export default function SettingsPage() {
  const { user: currentUser } = useAuth()
  const [activeTab, setActiveTab] = useState('systeme')

  return (
    <div className="sp-root">
      <nav className="sp-nav">
        <p className="sp-nav-section">Paramètres</p>
        {TABS.filter(t => !t.superAdminOnly || currentUser?.role === 'superadmin').map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={`sp-nav-item${activeTab === tab.id ? ' sp-nav-item--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} strokeWidth={1.8} />
              {tab.label}
            </button>
          )
        })}
      </nav>

      <div className="sp-content">
        {activeTab === 'systeme'      && <SystemeTab />}
        {activeTab === 'societe'      && <SocieteTab />}
        {activeTab === 'utilisateurs' && <UtilisateursTab currentUser={currentUser} />}
        {activeTab === 'categories'   && <CategoriesTab />}
        {activeTab === 'autres'       && <AutresTab currentUser={currentUser} />}
        {activeTab === 'devfix' && currentUser?.role === 'superadmin' && <DevFixPanel />}
      </div>
    </div>
  )
}
