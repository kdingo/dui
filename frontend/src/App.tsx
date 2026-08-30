import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api/client'
import { AuthContext } from './auth/AuthContext'
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

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [serverName, setServerName] = useState('DHCP UI (DUI)')

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
    return <div className="login-page">Loading...</div>
  }

  return (
    <AuthContext.Provider value={{ user, setUser, isAdmin: user?.role === 'admin' }}>
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
          <Route path="configure/import-export" element={<ImportExportPage />} />
          <Route path="configure/snapshots" element={<SnapshotsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="admin/users" element={<UsersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  )
}
