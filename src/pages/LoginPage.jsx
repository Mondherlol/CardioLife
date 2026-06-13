import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, User, Lock, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { login } from '../api/auth'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const { storeLogin } = useAuth()
  const navigate       = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await login(username, password)
      storeLogin(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Identifiants incorrects.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-logo-wrap">
          <div className="login-logo-icon">
            <Heart size={20} strokeWidth={2.5} />
          </div>
          <div className="login-logo-text">
            <span className="login-logo-brand">Cardio</span>
            <span className="login-logo-track">Track</span>
          </div>
        </div>

        <p className="login-tagline">Plateforme CardioLife</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label">Identifiant</label>
            <div className="form-input-wrap">
              <span className="form-input-icon"><User size={14} /></span>
              <input
                className="form-input"
                type="text"
                placeholder="Votre identifiant"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <div className="form-input-wrap">
              <span className="form-input-icon"><Lock size={14} /></span>
              <input
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {error && (
            <div className="login-error">
              <AlertTriangle size={13} />
              {error}
            </div>
          )}

          <button
            type="submit"
            className={`login-btn${loading ? ' login-btn--loading' : ''}`}
            disabled={loading}
          >
            {loading ? <span className="login-btn-spinner" /> : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
