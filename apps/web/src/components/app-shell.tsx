import { LogOut, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useInventoryStore } from '../app/inventory-store';
import { useAuth } from '../auth-context';
import { roleLabel } from '../lib/presentation';
import { MenuMorphIcon, SuccessMark } from './animated-icons';
import { StockLedgerMark } from './stockledger-mark';

export type NavigationMotion = 'overview' | 'items' | 'movement' | 'reports' | 'places' | 'team' | 'sell';
export type NavigationItem = readonly [path: string, label: string, icon: LucideIcon, motion: NavigationMotion];

export function AppShell({ navigation }: { navigation: readonly NavigationItem[] }) {
  const { error, refresh, notice, dismissNotice } = useInventoryStore();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = user?.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('') ?? 'SL';

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-mark"><StockLedgerMark /></span>StockLedger</NavLink>
        <nav id="primary-navigation" className={`top-nav ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
          {navigation.map(([to, label, Icon, motion]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon className="nav-icon" data-motion={motion} size={18} /><span>{label}</span>
          </NavLink>)}
          <button className="mobile-signout" onClick={signOut}><LogOut size={18} /><span>Sign out</span></button>
        </nav>
        <div className="navbar-account">
          <div className="topbar-user"><span className="avatar">{initials}</span><span className="topbar-user-copy"><b>{user?.fullName}</b><small>{user ? roleLabel[user.role] : ''}</small></span></div>
          <button className="signout-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={17} /></button>
        </div>
        <button className="menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}><MenuMorphIcon open={menuOpen} /></button>
      </div>
    </header>
    <button className={`nav-scrim ${menuOpen ? 'open' : ''}`} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
    <div className="shell-content">
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      <main className="page"><Outlet /></main>
      {notice && <div className={`toast ${notice.visible ? 'visible' : ''}`} key={notice.id} role="status" aria-live="polite">
        <SuccessMark className="toast-icon" />
        <div><b>{notice.title}</b><span>{notice.message}</span></div>
        <button aria-label="Dismiss notification" onClick={dismissNotice}><X size={16} /></button>
      </div>}
    </div>
  </div>;
}
