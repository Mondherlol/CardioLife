import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { AuthProvider, useAuth }       from './context/AuthContext'
import { SidebarProvider, useSidebar } from './context/SidebarContext'
import { useSwipeToOpen }              from './hooks/useSwipeToOpen'
import { canAccess, firstAccessiblePath } from './lib/access'
import LoginPage           from './pages/LoginPage'
import DashboardPage       from './pages/DashboardPage'
import ClientsPage         from './pages/ClientsPage'
import ClientDetailPage      from './pages/ClientDetailPage'
import ClientImportPage     from './pages/ClientImportPage'
import SiteDetailPage       from './pages/SiteDetailPage'
import StockPage           from './pages/StockPage'
import ProductImportPage   from './pages/ProductImportPage'
import ProductDetailPage   from './pages/ProductDetailPage'
import ProductItemPage     from './pages/ProductItemPage'
import ContractsPage       from './pages/ContractsPage'
import ContractDetailPage  from './pages/ContractDetailPage'
import SettingsPage             from './pages/SettingsPage'
import InstallationDetailPage   from './pages/InstallationDetailPage'
import InstallationFormPage     from './pages/InstallationFormPage'
import DocumentsPage            from './pages/DocumentsPage'
import PlanningPage             from './pages/PlanningPage'
import MaintenancePage          from './pages/MaintenancePage'
import InterventionFichePage    from './pages/InterventionFichePage'
import InterventionPrintPage    from './pages/InterventionPrintPage'
import InterventionBonPage      from './pages/InterventionBonPage'
import ProfilePage              from './pages/ProfilePage'
import TodoPage                 from './pages/TodoPage'
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

/**
 * Masquer une entrée de menu ne protège rien : l'URL restait tapable à la main.
 * Chaque groupe de routes passe désormais par le même tableau d'accès que la
 * barre latérale, et l'utilisateur est renvoyé vers le premier écran auquel il
 * a droit plutôt que sur une page vide ou une cascade de 403.
 */
function RequireAccess({ module }) {
  const { user } = useAuth()
  if (canAccess(user, module)) return <Outlet />
  return <Navigate to={firstAccessiblePath(user)} replace />
}

/** Racine « / » : le tableau de bord si permis, sinon le premier écran utile. */
function HomeGate() {
  const { user } = useAuth()
  return <Navigate to={firstAccessiblePath(user)} replace />
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
                <Route index element={<HomeGate />} />

                <Route element={<RequireAccess module="dashboard" />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                </Route>

                <Route element={<RequireAccess module="clients" />}>
                  <Route path="/clients"         element={<ClientsPage />} />
                  <Route path="/clients/import"  element={<ClientImportPage />} />
                  <Route path="/clients/:id"     element={<ClientDetailPage />} />
                  <Route path="/sites/:id"       element={<SiteDetailPage />} />
                </Route>

                <Route element={<RequireAccess module="stock" />}>
                  <Route path="/stock"       element={<StockPage />} />
                  {/* Avant /stock/:id — sinon « articles » serait pris pour un id de modèle. */}
                  <Route path="/stock/articles/:id" element={<ProductItemPage />} />
                  <Route path="/stock/import" element={<ProductImportPage />} />
                  <Route path="/stock/:id"  element={<ProductDetailPage />} />
                </Route>

                <Route element={<RequireAccess module="contracts" />}>
                  <Route path="/contrats"     element={<ContractsPage />} />
                  <Route path="/contrats/:id" element={<ContractDetailPage />} />
                </Route>

                {/* Contrôles, installations, formations et remplacements sont
                    les quatre volets d'un même suivi : une seule page à onglets. */}
                <Route element={<RequireAccess module="maintenance" />}>
                  <Route path="/devices/new"      element={<InstallationFormPage />} />
                  <Route path="/devices/:id"      element={<InstallationDetailPage />} />
                  <Route path="/devices/:id/edit" element={<InstallationFormPage />} />
                  <Route path="/maintenance"      element={<Navigate to="/maintenance/controles" replace />} />
                  <Route path="/maintenance/:tab" element={<MaintenancePage />} />
                  <Route path="/interventions/:id" element={<InterventionFichePage />} />
                  {/* Anciennes entrées de menu — les liens en circulation restent valides. */}
                  <Route path="/interventions"   element={<Navigate to="/maintenance/controles" replace />} />
                  <Route path="/remplacements"   element={<Navigate to="/maintenance/remplacements" replace />} />
                  <Route path="/formations"      element={<Navigate to="/maintenance/formations" replace />} />
                </Route>

                <Route path="/profil"   element={<ProfilePage />} />
                <Route path="/planning" element={<PlanningPage />} />

                <Route element={<RequireAccess module="documents" />}>
                  <Route path="/documents" element={<DocumentsPage />} />
                </Route>

                {/* Suivi du chantier logiciel — Admins et Super Admins seuls. */}
                <Route element={<RequireAccess module="dev" />}>
                  <Route path="/dev"    element={<TodoPage />} />
                  {/* Second nom en circulation dans les échanges d'équipe. */}
                  <Route path="/to-do"  element={<Navigate to="/dev" replace />} />
                </Route>

                <Route element={<RequireAccess module="settings" />}>
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="/interventions/:id/print" element={<InterventionPrintPage />} />
            <Route path="/interventions/:id/bon"   element={<InterventionBonPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SidebarProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
