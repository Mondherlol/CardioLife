import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { AuthProvider, useAuth }       from './context/AuthContext'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import { useSwipeToOpen }              from './hooks/useSwipeToOpen'
import LoginPage           from './pages/LoginPage'
import DashboardPage       from './pages/DashboardPage'
import ClientsPage         from './pages/ClientsPage'
import ClientDetailPage      from './pages/ClientDetailPage'
import ClientImportPage     from './pages/ClientImportPage'
import StockPage           from './pages/StockPage'
import ProductDetailPage   from './pages/ProductDetailPage'
import PacksPage           from './pages/PacksPage'
import ContractsPage       from './pages/ContractsPage'
import ContractFormPage    from './pages/ContractFormPage'
import ContractDetailPage  from './pages/ContractDetailPage'
import SettingsPage             from './pages/SettingsPage'
import DevicesPage              from './pages/DevicesPage'
import InstallationDetailPage   from './pages/InstallationDetailPage'
import InstallationFormPage     from './pages/InstallationFormPage'
import DocumentsPage            from './pages/DocumentsPage'
import PlanningPage             from './pages/PlanningPage'
import InterventionsPage        from './pages/InterventionsPage'
import InterventionFichePage    from './pages/InterventionFichePage'
import InterventionPrintPage    from './pages/InterventionPrintPage'
import ProfilePage              from './pages/ProfilePage'
import Sidebar        from './components/Sidebar'
import TopBar         from './components/TopBar'

function Layout() {
  const { logout, user }                          = useAuth()
  const { isMobileOpen, openMobile, closeMobile } = useSidebar()

  useSwipeToOpen(openMobile, closeMobile, isMobileOpen)

  return (
    <div className="app-layout">
      {/* Overlay mobile */}
      {isMobileOpen && (
        <div className="sidebar-overlay" onClick={closeMobile} />
      )}

      <Sidebar />

      <div className="main-area">
        <TopBar onLogout={logout} user={user} />
        <Outlet />
      </div>

      <ToastContainer
        position="bottom-right"
        autoClose={3500}
        hideProgressBar={false}
        closeOnClick
        pauseOnHover
        draggable={false}
        toastClassName="ct-toast"
      />
    </div>
  )
}

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="app-loading"><span className="spinner" /></div>
  if (!user)   return <Navigate to="/login" replace />
  return <Outlet />
}

function DashboardGate() {
  const { user } = useAuth()
  if (user?.role === 'technicien') return <Navigate to="/interventions" replace />
  return <DashboardPage />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SidebarProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardGate />} />
                <Route path="/clients"          element={<ClientsPage />} />
                <Route path="/clients/import"  element={<ClientImportPage />} />
                <Route path="/clients/:id"     element={<ClientDetailPage />} />
                <Route path="/stock"       element={<StockPage />} />
                <Route path="/stock/:id"  element={<ProductDetailPage />} />
                <Route path="/packs"      element={<PacksPage />} />
                <Route path="/contrats"          element={<ContractsPage />} />
                <Route path="/contrats/new"      element={<ContractFormPage />} />
                <Route path="/contrats/:id"      element={<ContractDetailPage />} />
                <Route path="/contrats/:id/edit" element={<ContractFormPage />} />
                <Route path="/devices"          element={<DevicesPage />} />
                <Route path="/devices/new"     element={<InstallationFormPage />} />
                <Route path="/devices/:id"     element={<InstallationDetailPage />} />
                <Route path="/devices/:id/edit" element={<InstallationFormPage />} />
                <Route path="/interventions"     element={<InterventionsPage />} />
                <Route path="/interventions/:id" element={<InterventionFichePage />} />
                <Route path="/profil"            element={<ProfilePage />} />
                <Route path="/planning"  element={<PlanningPage />} />
                <Route path="/documents" element={<DocumentsPage />} />
                <Route path="/settings"  element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="/interventions/:id/print" element={<InterventionPrintPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </SidebarProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
