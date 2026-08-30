import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

interface AppLayoutProps {
  serverName: string
}

export function AppLayout({ serverName }: AppLayoutProps) {
  const { user, setUser, isAdmin } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await api.logout()
    setUser(null)
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>{serverName}</h1>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/leases">Leases</NavLink>
          <NavLink to="/logs">View logs</NavLink>
          <span className="nav-group-title">Configure</span>
          <NavLink to="/configure/networks">Networks</NavLink>
          <NavLink to="/configure/clients">DHCP clients</NavLink>
          <NavLink to="/configure/options">Options</NavLink>
          <NavLink to="/configure/import-export">Import/export</NavLink>
          <NavLink to="/configure/snapshots">Config snapshots</NavLink>
          {isAdmin && (
            <>
              <span className="nav-group-title">Admin</span>
              <NavLink to="/admin" end>
                Server admin
              </NavLink>
              <NavLink to="/admin/users">Users</NavLink>
            </>
          )}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <strong>{serverName}</strong>
          <div className="actions">
            <span className="muted">{user?.username}</span>
            <button className="secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
