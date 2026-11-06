import { type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useInventoryStore } from '../app/inventory-store';
import { useAuth } from '../auth-context';
import { AccountMenu } from './account-menu';
import { MenuMorphIcon } from './animated-icons';
import { StockLedgerMark } from './stockledger-mark';
import { LowStockNotifications } from './low-stock-notifications';
import { useCompanySettings } from '../app/company-settings-store';
import { DealsTourProvider } from './deals-tour';

export type NavigationMotion = 'overview' | 'items' | 'movement' | 'reports' | 'places' | 'team' | 'sell';
export type NavigationItem = readonly [path: string, label: string, icon: LucideIcon, motion: NavigationMotion];

export function AppShell({ navigation }: { navigation: readonly NavigationItem[] }) {
  const { error, refresh, refreshing: inventoryRefreshing } = useInventoryStore();
  const { signOut, user, refreshState, resumeSession } = useAuth();
  const { terms, error: settingsError, refreshing: settingsRefreshing, refresh: refreshSettings } = useCompanySettings();
  const refreshing = refreshState === 'refreshing' || inventoryRefreshing || settingsRefreshing;
  const blocked = refreshState !== 'active' || refreshing;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const closeMenu = () => { setMenuOpen(false); menuTrigger.current?.focus(); };
  useEffect(() => {
    if (!menuOpen) return;
    const nav = document.getElementById('primary-navigation')!;
    nav.querySelector<HTMLAnchorElement>('a')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); menuTrigger.current?.focus(); }
      if (event.key === 'Tab') {
        const stops = [...nav.querySelectorAll<HTMLAnchorElement>('a'), menuTrigger.current!];
        const index = stops.indexOf(document.activeElement as HTMLAnchorElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); stops.at(-1)?.focus(); }
        else if (!event.shiftKey && index === stops.length - 1) { event.preventDefault(); stops[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [menuOpen]);
  const activateRoute = () => { setMenuOpen(false); requestAnimationFrame(() => main.current?.focus()); };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/" className="brand" inert={menuOpen} onClick={activateRoute}><span className="brand-mark"><StockLedgerMark /></span>StockLedger</NavLink>
        <nav id="primary-navigation" className={`top-nav ${menuOpen ? 'open' : ''}`} aria-label="Main navigation" inert={blocked}>
          {navigation.map(([to, label, Icon, motion]) => <NavLink key={to} to={to} end={to === '/'} title={label === 'Items' ? terms.Items : label} onClick={activateRoute} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon className="nav-icon" data-motion={motion} size={18} /><span>{label === 'Items' ? terms.Items : label}</span>
          </NavLink>)}
        </nav>
        <div className="navbar-account" inert={menuOpen}>
          <LowStockNotifications />
          <AccountMenu />
        </div>
        <button ref={menuTrigger} className="menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}><MenuMorphIcon open={menuOpen} /></button>
      </div>
    </header>
    {menuOpen && <button className="nav-scrim open" tabIndex={-1} aria-label="Close navigation" onClick={closeMenu} />}
    <div className="shell-content" inert={menuOpen}>
      {user?.isDemo && <div className="demo-mode-banner" role="status"><span>You are viewing a read-only demo.</span><NavLink to="/signup" onClick={signOut}>Create a workspace</NavLink></div>}
      {refreshState === 'paused' && <div className="demo-mode-banner" role="status"><span>Updates paused while you were away. Return to refresh before continuing.</span><button className="button secondary" onClick={() => void resumeSession()}>Continue and refresh</button></div>}
      {refreshing && refreshState !== 'paused' && <div className="demo-mode-banner" role="status">Refreshing your workspace. Your entries are kept.</div>}
      {refreshState === 'error' && <div className="error-banner" role="alert"><span>We could not refresh your workspace. The displayed data may be out of date. Your entries are kept.</span><button onClick={() => void resumeSession()}>Retry refresh</button></div>}
      {settingsError && <div className="error-banner" role="alert"><span>Business settings could not refresh. The displayed settings may be out of date.</span><button onClick={() => void refreshSettings()}>Retry settings</button></div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
      <DealsTourProvider><main id="main-content" ref={main} tabIndex={-1} className="page" inert={blocked}><Outlet /></main></DealsTourProvider>
    </div>
  </div>;
}
