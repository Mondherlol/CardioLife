import { useState, useEffect, useCallback } from 'react'
import {
  Monitor, Users, MoreHorizontal, Plus, Pencil, Trash2,
  KeyRound, Power, X, Eye, EyeOff, ShieldOff,
  CheckCircle2, AlertTriangle, HardDrive, Save,
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/AuthContext'
import {
  getUsers, createUser, updateUser, resetUserPassword, deleteUser,
} from '../api/users'
import { getAppSettings, updateAppSettings } from '../api/appSettings'
import { getFolderTree } from '../api/documents'

/* ─── Constants ─────────────────────────────────────────────── */

const TABS = [
  { id: 'systeme',       label: 'Système',       icon: Monitor },
  { id: 'utilisateurs',  label: 'Utilisateurs',  icon: Users },
  { id: 'autres',        label: 'Autres',        icon: MoreHorizontal },
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

const PERM_KEYS = [
  'canManageClients',
  'canManageDevices',
  'canManageContracts',
  'canManageStock',
  'canManageInterventions',
  'canManageUsers',
  'canViewReports',
]

const PERM_LABELS = {
  canManageClients:       'Gérer les clients',
  canManageDevices:       'Gérer les appareils',
  canManageContracts:     'Gérer les contrats',
  canManageStock:         'Gérer le stock',
  canManageInterventions: 'Gérer les interventions',
  canManageUsers:         'Gérer les utilisateurs',
  canViewReports:         'Voir les rapports',
}

const EMPTY_PERMS = Object.fromEntries(PERM_KEYS.map(k => [k, false]))

const EMPTY_FORM = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  role: 'readonly',
  permissions: { ...EMPTY_PERMS },
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

  const isSuperAdmin = currentUser.role === 'superadmin'

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  function setPerm(key, val) {
    setForm(f => ({ ...f, permissions: { ...f.permissions, [key]: val } }))
  }

  function validate() {
    const e = {}
    if (!form.fullName.trim())  e.fullName = 'Nom complet requis.'
    if (!form.username.trim())  e.username = 'Identifiant requis.'
    if (!form.email.trim())     e.email    = 'Email requis.'
    if (mode === 'create' && form.password.length < 8) e.password = 'Minimum 8 caractères.'
    if (mode === 'edit'   && form.password && form.password.length < 8) e.password = 'Minimum 8 caractères.'
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
      else if (form.password) payload.password = form.password
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

  const showPerms = form.role !== 'superadmin'
  const permDisabled = !isSuperAdmin && form.role === 'superadmin'

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

            <div className="form-group">
              <label className="form-label">
                {mode === 'create' ? 'Mot de passe' : 'Nouveau mot de passe (laisser vide pour ne pas changer)'}
              </label>
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

            <div className="form-group">
              <label className="form-label">Rôle</label>
              <select
                className="form-input form-input--plain"
                value={form.role}
                onChange={e => setField('role', e.target.value)}
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
                <div className="perm-grid">
                  {PERM_KEYS.map(key => (
                    <label key={key} className="perm-item">
                      <span>{PERM_LABELS[key]}</span>
                      <span className="perm-toggle">
                        <input
                          type="checkbox"
                          checked={!!form.permissions[key]}
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
    if (pwd.length < 8) { setError('Minimum 8 caractères.'); return }
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
  const canManage = currentUser.role === 'admin' || currentUser.role === 'superadmin'

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

function AutresTab() {
  return (
    <>
      <h2 className="sp-section-title">Autres</h2>
      <p className="sp-section-desc">Paramètres divers.</p>
      <div className="sp-placeholder">
        <MoreHorizontal size={40} strokeWidth={1.2} />
        <p style={{ marginTop: 12 }}>Aucun paramètre disponible pour l'instant.</p>
      </div>
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
        {TABS.map(tab => {
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
        {activeTab === 'utilisateurs' && <UtilisateursTab currentUser={currentUser} />}
        {activeTab === 'autres'       && <AutresTab />}
      </div>
    </div>
  )
}
