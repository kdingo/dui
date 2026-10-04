import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, setCsrfToken, setUnauthorizedHandler } from './api/client'
import { AuthContext } from './auth/AuthContext'
import { ConfirmProvider } from './components/ConfirmDialog'
import { Logo } from './components/Logo'
import type { User } from './api/types'
import { AppLayout } from './layouts/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { LeasesPage } from './pages/LeasesPage'
import { LogsPage } from './pages/LogsPage'
import { NetworksPage } from './pages/NetworksPage'
import { ClientsPage } from './pages/ClientsPage'
import { OptionsPage } from './pages/OptionsPage'
import { ImportExportPage } from './pages/ImportExportPage'
import { SnapshotsPage } from './pages/SnapshotsPage'
import { AdminPage } from './pages/AdminPage'
import { UsersPage } from './pages/UsersPage'

function ProtectedRoute({ user, children }: { user: User | null; children: React.ReactNode }) {
  const location = useLocation()
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

function AdminRoute({ user, children }: { user: User | null; children: React.ReactNode }) {
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [serverName, setServerName] = useState('DUI')
  const navigate = useNavigate()
  const location = useLocation()
  const userRef = useRef(user)
  const pathRef = useRef(location.pathname)
  userRef.current = user
  pathRef.current = location.pathname

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!userRef.current) return
      userRef.current = null
      setCsrfToken('')
      setUser(null)
      navigate('/login', { replace: true, state: { from: pathRef.current, expired: true } })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  useEffect(() => {
    api
      .me()
      .then((current) => {
        setUser(current)
        return api.dashboard()
      })
      .then((dashboard) => setServerName(dashboard.server_name))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="boot" role="status" aria-label="Loading">
        <Logo size={64} fill="loop" />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, setUser, isAdmin: user?.role === 'admin' }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route
            element={
              <ProtectedRoute user={user}>
                <AppLayout serverName={serverName} />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="leases" element={<LeasesPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="configure/networks" element={<NetworksPage />} />
            <Route path="configure/clients" element={<ClientsPage />} />
            <Route path="configure/options" element={<OptionsPage />} />
            <Route path="configure/snapshots" element={<SnapshotsPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/users" element={<UsersPage />} />
            <Route
              path="admin/import-export"
              element={
                <AdminRoute user={user}>
                  <ImportExportPage />
                </AdminRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>
  )
}
