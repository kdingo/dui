import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { LanguageSelect } from '../components/LanguageSelect'
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
  const { t } = useTranslation()
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
            {t('nav.dashboard')}
          </NavItem>
          <NavItem to="/leases">{t('nav.leases')}</NavItem>
          <NavItem to="/logs">{t('nav.logs')}</NavItem>
          <span className="nav-group-title">{t('nav.configure')}</span>
          <NavItem to="/configure/networks">{t('nav.networks')}</NavItem>
          <NavItem to="/configure/clients">{t('nav.clients')}</NavItem>
          <NavItem to="/configure/options">{t('nav.options')}</NavItem>
          <NavItem to="/configure/snapshots">{t('nav.snapshots')}</NavItem>
          {isAdmin && (
            <>
              <span className="nav-group-title">{t('nav.admin')}</span>
              <NavItem to="/admin" end>
                {t('nav.serverAdmin')}
              </NavItem>
              <NavItem to="/admin/users">{t('nav.users')}</NavItem>
              <NavItem to="/admin/import-export">{t('nav.importExport')}</NavItem>
            </>
          )}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <strong>{serverName}</strong>
          <div className="actions">
            <Link className="user-chip" to="/account/password" title={t('nav.changePassword')}>
              <span className="avatar" aria-hidden="true">
                {user?.username.charAt(0).toUpperCase()}
              </span>
              {user?.username}
            </Link>
            <LanguageSelect />
            <ThemeToggle />
            <button className="secondary" onClick={handleLogout}>
              {t('nav.logout')}
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
