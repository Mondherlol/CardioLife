import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import {
  User, Mail, Phone, Lock, Camera, Trash2, Plus, X, Eye, EyeOff, Save,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  getProfile, updateProfile, changePassword,
  uploadAvatar, deleteAvatar, avatarUrl,
} from '../api/profile'

/* ─── Role labels ─── */
const ROLE_LABELS = {
  superadmin: 'Super Admin',
  admin:      'Administrateur',
  technicien: 'Technicien',
  commercial: 'Commercial',
  assistante: 'Assistante',
  readonly:   'Lecture seule',
}

/* ─── Initials helper ─── */
function initials(name) {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

/* ─── Section card ─── */
function Card({ icon: Icon, title, children }) {
  return (
    <div className="profile-card">
      <div className="profile-card-title">
        <Icon size={14} strokeWidth={2} />
        {title}
      </div>
      <div className="profile-card-body">
        {children}
      </div>
    </div>
  )
}

/* ─── Form field ─── */
function Field({ label, children }) {
  return (
    <div className="form-field" style={{ marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}

export default function ProfilePage() {
  const { user, updateUser } = useAuth()
  const avatarInputRef = useRef(null)

  /* ── Info form ── */
  const [info, setInfo]       = useState({ fullName: '', email: '', phones: [] })
  const [savingInfo, setSavingInfo] = useState(false)

  /* ── Password form ── */
  const [pwd,     setPwd]     = useState({ current: '', next: '', confirm: '' })
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false })
  const [savingPwd, setSavingPwd] = useState(false)

  /* ── Avatar ── */
  const [uploadingAv,  setUploadingAv]  = useState(false)
  const [deletingAv,   setDeletingAv]   = useState(false)

  /* ── Load profile ── */
  useEffect(() => {
    getProfile()
      .then(data => {
        setInfo({
          fullName: data.fullName || '',
          email:    data.email    || '',
          phones:   data.phones?.length ? data.phones : [''],
        })
        // Sync avatar/phones into AuthContext if needed
        updateUser({ avatar: data.avatar, phones: data.phones, fullName: data.fullName, email: data.email })
      })
      .catch(() => toast.error('Erreur de chargement du profil.'))
  }, []) // eslint-disable-line

  /* ── Phones helpers ── */
  function setPhone(idx, val) {
    setInfo(prev => {
      const phones = [...prev.phones]
      phones[idx] = val
      return { ...prev, phones }
    })
  }

  function addPhone() {
    setInfo(prev => ({ ...prev, phones: [...prev.phones, ''] }))
  }

  function removePhone(idx) {
    setInfo(prev => {
      const phones = prev.phones.filter((_, i) => i !== idx)
      return { ...prev, phones: phones.length ? phones : [''] }
    })
  }

  /* ── Save info ── */
  async function handleSaveInfo(e) {
    e.preventDefault()
    if (!info.fullName.trim()) return toast.error('Le nom complet est requis.')
    setSavingInfo(true)
    try {
      const updated = await updateProfile({
        fullName: info.fullName,
        email:    info.email,
        phones:   info.phones.filter(p => p.trim()),
      })
      updateUser({ fullName: updated.fullName, email: updated.email, phones: updated.phones })
      toast.success('Informations mises à jour.')
    } catch (err) {
      toast.error(err.message || 'Erreur de sauvegarde.')
    } finally {
      setSavingInfo(false)
    }
  }

  /* ── Change password ── */
  async function handleChangePwd(e) {
    e.preventDefault()
    if (!pwd.current) return toast.error('Saisissez votre mot de passe actuel.')
    if (pwd.next.length < 8) return toast.error('Minimum 8 caractères.')
    if (pwd.next !== pwd.confirm) return toast.error('Les mots de passe ne correspondent pas.')
    setSavingPwd(true)
    try {
      await changePassword({ currentPassword: pwd.current, newPassword: pwd.next })
      toast.success('Mot de passe modifié.')
      setPwd({ current: '', next: '', confirm: '' })
    } catch (err) {
      toast.error(err.message || 'Erreur.')
    } finally {
      setSavingPwd(false)
    }
  }

  /* ── Avatar upload ── */
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadingAv(true)
    try {
      const updated = await uploadAvatar(file)
      updateUser({ avatar: updated.avatar })
      toast.success('Photo de profil mise à jour.')
    } catch (err) {
      toast.error(err.message || 'Erreur upload.')
    } finally {
      setUploadingAv(false)
    }
  }

  /* ── Avatar delete ── */
  async function handleDeleteAvatar() {
    setDeletingAv(true)
    try {
      const updated = await deleteAvatar()
      updateUser({ avatar: updated.avatar })
      toast.success('Photo de profil supprimée.')
    } catch (err) {
      toast.error(err.message || 'Erreur.')
    } finally {
      setDeletingAv(false)
    }
  }

  const currentAvatar = user?.avatar

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title"><User size={20} strokeWidth={1.8} /> Mon profil</h1>
          <p className="page-subtitle">{ROLE_LABELS[user?.role] || user?.role}</p>
        </div>
      </div>

      <div className="profile-page-wrap">
        {/* ── Avatar card ── */}
        <div className="profile-card">
          <div className="profile-avatar-row">
            {/* Avatar */}
            <div className="profile-avatar-wrap">
              {currentAvatar ? (
                <img src={avatarUrl(currentAvatar)} alt="avatar" className="profile-avatar" />
              ) : (
                <div className="profile-avatar-initials">
                  {initials(user?.fullName || user?.username)}
                </div>
              )}
              <button
                type="button"
                className="profile-avatar-edit"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAv}
                title="Changer la photo"
              >
                {uploadingAv
                  ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                  : <Camera size={13} />
                }
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                capture="user"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
            </div>

            <div className="profile-avatar-name">{user?.fullName || user?.username}</div>
            <div className="profile-avatar-role">{ROLE_LABELS[user?.role] || user?.role}</div>

            {currentAvatar && (
              <button
                type="button"
                className="btn btn--ghost"
                style={{ fontSize: 12, padding: '4px 12px', gap: 5 }}
                onClick={handleDeleteAvatar}
                disabled={deletingAv}
              >
                {deletingAv
                  ? <span className="spinner spinner--sm" />
                  : <Trash2 size={12} />
                }
                Supprimer la photo
              </button>
            )}
          </div>
        </div>

        {/* ── Informations personnelles ── */}
        <Card icon={User} title="Informations personnelles">
          <form onSubmit={handleSaveInfo} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Nom complet *">
              <input
                className="form-input"
                value={info.fullName}
                onChange={e => setInfo(p => ({ ...p, fullName: e.target.value }))}
                placeholder="Jean Dupont"
              />
            </Field>

            <Field label="Adresse e-mail *">
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  className="form-input"
                  type="email"
                  value={info.email}
                  onChange={e => setInfo(p => ({ ...p, email: e.target.value }))}
                  placeholder="jean@example.com"
                  style={{ paddingLeft: 30 }}
                />
              </div>
            </Field>

            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Phone size={12} /> Téléphones
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {info.phones.map((p, idx) => (
                  <div key={idx} className="profile-phone-row">
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Phone size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input
                        className="form-input"
                        type="tel"
                        value={p}
                        onChange={e => setPhone(idx, e.target.value)}
                        placeholder="+216 XX XXX XXX"
                        style={{ paddingLeft: 30 }}
                      />
                    </div>
                    <button
                      type="button"
                      className="profile-phone-del"
                      onClick={() => removePhone(idx)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button type="button" className="profile-add-phone" onClick={addPhone}>
                  <Plus size={13} /> Ajouter un numéro
                </button>
              </div>
            </div>

            <div className="profile-save-row">
              <button type="submit" className="btn btn--primary" disabled={savingInfo}>
                {savingInfo ? <span className="spinner spinner--sm" /> : <Save size={14} />}
                Enregistrer
              </button>
            </div>
          </form>
        </Card>

        {/* ── Sécurité ── */}
        <Card icon={Lock} title="Changer le mot de passe">
          <form onSubmit={handleChangePwd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { key: 'current', label: 'Mot de passe actuel' },
              { key: 'next',    label: 'Nouveau mot de passe' },
              { key: 'confirm', label: 'Confirmer le nouveau mot de passe' },
            ].map(({ key, label }) => (
              <Field key={key} label={label}>
                <div style={{ position: 'relative' }}>
                  <Lock size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    className="form-input"
                    type={showPwd[key] ? 'text' : 'password'}
                    value={pwd[key]}
                    onChange={e => setPwd(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={key === 'current' ? '••••••••' : 'Minimum 8 caractères'}
                    style={{ paddingLeft: 30, paddingRight: 36 }}
                  />
                  <button
                    type="button"
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                      display: 'flex', padding: 2,
                    }}
                    onClick={() => setShowPwd(p => ({ ...p, [key]: !p[key] }))}
                  >
                    {showPwd[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {key === 'next' && pwd.next.length > 0 && pwd.next.length < 8 && (
                  <p className="profile-pwd-hint">⚠ Minimum 8 caractères</p>
                )}
              </Field>
            ))}

            <div className="profile-save-row">
              <button type="submit" className="btn btn--primary" disabled={savingPwd}>
                {savingPwd ? <span className="spinner spinner--sm" /> : <Lock size={14} />}
                Changer le mot de passe
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
