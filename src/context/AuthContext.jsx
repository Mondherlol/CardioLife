import { createContext, useContext, useState, useEffect } from 'react'
import { me } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = sessionStorage.getItem('token')
    if (!token) { setLoading(false); return }

    me()
      .then(data => setUser(data.user))
      .catch(() => sessionStorage.removeItem('token'))
      .finally(() => setLoading(false))
  }, [])

  function storeLogin(token, userData) {
    sessionStorage.setItem('token', token)
    setUser(userData)
  }

  function updateUser(partial) {
    setUser(prev => prev ? { ...prev, ...partial } : prev)
  }

  function logout() {
    sessionStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, storeLogin, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
