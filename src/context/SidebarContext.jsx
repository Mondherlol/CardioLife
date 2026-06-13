import { createContext, useContext, useState, useCallback } from 'react'

const SidebarContext = createContext(null)

export function SidebarProvider({ children }) {
  const [isCompact,     setIsCompact]     = useState(
    () => localStorage.getItem('sidebar-compact') === 'true'
  )
  const [isMobileOpen,  setIsMobileOpen]  = useState(false)

  const toggleCompact = useCallback(() => {
    setIsCompact(v => {
      localStorage.setItem('sidebar-compact', String(!v))
      return !v
    })
  }, [])

  const openMobile  = useCallback(() => setIsMobileOpen(true),  [])
  const closeMobile = useCallback(() => setIsMobileOpen(false), [])

  return (
    <SidebarContext.Provider value={{ isCompact, toggleCompact, isMobileOpen, openMobile, closeMobile }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
