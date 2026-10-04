import { AnimatePresence, motion } from 'motion/react'
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { EASE_OUT, PILL_SPRING } from '../lib/motion'

interface AppLayoutProps {
  serverName: string
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={end} className="nav-link">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-pill" className="nav-pill" transition={PILL_SPRING} />}
          <span className="nav-label">{children}</span>
        </>
      )}
    </NavLink>
  )
}

export function AppLayout({ serverName }: AppLayoutProps) {
  const { user, setUser, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Captured per render so an exiting page keeps showing its own content.
  const outlet = useOutlet()

  async function handleLogout() {
    await api.logout()
    setUser(null)
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo size={30} />
          <h1>{serverName}</h1>
        </div>
        <nav>
          <NavItem to="/" end>
            Dashboard
          </NavItem>
          <NavItem to="/leases">Leases</NavItem>
          <NavItem to="/logs">View logs</NavItem>
          <span className="nav-group-title">Configure</span>
          <NavItem to="/configure/networks">Networks</NavItem>
          <NavItem to="/configure/clients">DHCP clients</NavItem>
          <NavItem to="/configure/options">Server Options</NavItem>
          <NavItem to="/configure/snapshots">Config snapshots</NavItem>
          {isAdmin && (
            <>
              <span className="nav-group-title">Admin</span>
              <NavItem to="/admin" end>
                Server admin
              </NavItem>
              <NavItem to="/admin/users">Users</NavItem>
              <NavItem to="/admin/import-export">Import/Export</NavItem>
            </>
          )}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <strong>{serverName}</strong>
          <div className="actions">
            <span className="user-chip">
              <span className="avatar" aria-hidden="true">
                {user?.username.charAt(0).toUpperCase()}
              </span>
              {user?.username}
            </span>
            <ThemeToggle />
            <button className="secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>
        <main className="content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.1, ease: 'easeIn' } }}
              transition={{ duration: 0.24, ease: EASE_OUT }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
