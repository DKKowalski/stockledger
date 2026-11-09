import { type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useInventoryStore } from '../app/inventory-store';
import { useAuth } from '../auth-context';
import { AccountMenu } from './account-menu';
import { MenuMorphIcon } from './animated-icons';
import { HeaderNav, MobileNav, SidebarHeaderRow, SidebarNav, useNavItems } from './app-nav';
import { StockLedgerMark } from './stockledger-mark';
import { LowStockNotifications } from './low-stock-notifications';
import { useCompanySettings } from '../app/company-settings-store';
import { DealsTourProvider } from './deals-tour';
import { Sidebar, SidebarFooter, SidebarHeader, SidebarContent, SidebarProvider } from './ui/sidebar';
import { saveSidebarCollapsed, useNavLayout, useSidebarCollapsed } from '../lib/nav-layout';
import { cn } from '@/lib/utils';

export type NavigationMotion = 'overview' | 'items' | 'movement' | 'reports' | 'places' | 'team' | 'sell';
export type NavigationItem = readonly [path: string, label: string, icon: LucideIcon, motion: NavigationMotion];

export function AppShell({ navigation }: { navigation: readonly NavigationItem[] }) {
  const { error, refresh, refreshing: inventoryRefreshing } = useInventoryStore();
  const { signOut, user, refreshState, resumeSession } = useAuth();
  const { error: settingsError, refreshing: settingsRefreshing, refresh: refreshSettings } = useCompanySettings();
  const refreshing = refreshState === 'refreshing' || inventoryRefreshing || settingsRefreshing;
  const blocked = refreshState !== 'active' || refreshing;
  const items = useNavItems(navigation);
  const sidebar = useNavLayout() === 'sidebar';
  const collapsed = useSidebarCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    // Leaving the compact layout closes the sheet and hands focus to the page.
    const query = window.matchMedia('(min-width: 768px)');
    const change = () => { if (query.matches) { setMenuOpen(false); requestAnimationFrame(() => main.current?.focus()); } };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  const brand = <NavLink to="/" className="brand flex min-h-11 items-center gap-2.5 rounded-lg font-heading text-lg font-bold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={focusMain}><span className="brand-mark"><StockLedgerMark /></span>StockLedger</NavLink>;
  function focusMain() { requestAnimationFrame(() => main.current?.focus()); }

  const topbar = <header className={cn('topbar sticky top-0 z-40 h-16 border-b md:h-[76px] bg-white/90 backdrop-blur', sidebar && 'md:hidden')}>
    <div className="mx-auto flex h-full w-full max-w-[1450px] items-center gap-3 px-4 md:gap-4 md:px-6">
      {brand}
      {!sidebar && <HeaderNav items={items} inert={blocked} onNavigate={focusMain} />}
      <div className={cn('flex items-center gap-1 md:gap-2.5', sidebar ? 'ml-auto' : 'ml-auto md:ml-0')}>
        <LowStockNotifications />
        <AccountMenu compact={!sidebar && items.length > 6} />
        <button ref={menuTrigger} type="button" className="menu-button grid size-11 place-items-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden" aria-label="Open navigation" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><MenuMorphIcon open={false} /></button>
      </div>
    </div>
  </header>;

  const content = <div className="shell-content min-w-0 flex-1">
    {user?.isDemo && <div className="demo-mode-banner" role="status"><span>You are viewing a read-only demo.</span><NavLink to="/signup" onClick={signOut}>Create a workspace</NavLink></div>}
    {refreshState === 'paused' && <div className="demo-mode-banner" role="status"><span>Updates paused while you were away. Return to refresh before continuing.</span><button className="button secondary" onClick={() => void resumeSession()}>Continue and refresh</button></div>}
    {refreshing && refreshState !== 'paused' && <div className="demo-mode-banner" role="status">Refreshing your workspace. Your entries are kept.</div>}
    {refreshState === 'error' && <div className="error-banner" role="alert"><span>We could not refresh your workspace. The displayed data may be out of date. Your entries are kept.</span><button onClick={() => void resumeSession()}>Retry refresh</button></div>}
    {settingsError && <div className="error-banner" role="alert"><span>Business settings could not refresh. The displayed settings may be out of date.</span><button onClick={() => void refreshSettings()}>Retry settings</button></div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
    <DealsTourProvider><main id="main-content" ref={main} tabIndex={-1} className="page" inert={blocked}><Outlet /></main></DealsTourProvider>
  </div>;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {sidebar
      ? <SidebarProvider open={!collapsed} onOpenChange={(open) => saveSidebarCollapsed(!open)} className="flex-col md:flex-row">
        {topbar}
        <Sidebar collapsible="icon">
          <SidebarHeader className="p-3 group-data-[collapsible=icon]:px-1.5"><SidebarHeaderRow onNavigate={focusMain} /></SidebarHeader>
          <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1.5"><SidebarNav items={items} inert={blocked} /></SidebarContent>
          <SidebarFooter className="gap-2 p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-1.5">
            <LowStockNotifications />
            <AccountMenu variant="sidebar" />
          </SidebarFooter>
        </Sidebar>
        {content}
      </SidebarProvider>
      : <>{topbar}{content}</>}
    <MobileNav items={items} open={menuOpen} onOpenChange={setMenuOpen} trigger={menuTrigger} mainRef={main} inert={blocked} />
  </div>;
}
