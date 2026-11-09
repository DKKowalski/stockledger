import { Ellipsis, PanelLeft, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useCompanySettings } from '../app/company-settings-store';
import { cn } from '@/lib/utils';
import type { NavigationItem } from './app-shell';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './ui/sidebar';
import { Button } from './ui/button';
import { StockLedgerMark } from './stockledger-mark';

type Item = { to: string; label: string; Icon: NavigationItem[2]; motion: NavigationItem[3] };

export function useNavItems(navigation: readonly NavigationItem[]): Item[] {
  const { terms } = useCompanySettings();
  return useMemo(() => navigation.map(([to, label, Icon, motion]) => ({ to, label: label === 'Items' ? terms.Items : label, Icon, motion })), [navigation, terms.Items]);
}

function isActivePath(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

const linkBase = 'nav-link relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const iconProps = (motion: Item['motion']) => ({ className: 'nav-icon size-[18px] shrink-0', 'data-motion': motion, 'aria-hidden': true as const });

/** Tabs in the header. Items that do not fit move into a "More" menu instead of wrapping or scrolling. */
export function HeaderNav({ items, inert, onNavigate }: { items: Item[]; inert: boolean; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(items.length);
  useLayoutEffect(() => {
    const compute = () => {
      const box = container.current, probe = measure.current;
      if (!box || !probe || box.clientWidth === 0) return;
      const widths = [...probe.children].map((child) => (child as HTMLElement).offsetWidth);
      const more = widths.pop() ?? 0, gap = 4, available = box.clientWidth;
      const total = widths.reduce((sum, width) => sum + width + gap, -gap);
      if (total <= available) { setFit(items.length); return; }
      let used = more, count = 0;
      for (const width of widths) { if (used + gap + width > available) break; used += gap + width; count += 1; }
      setFit(Math.max(count, 0));
    };
    compute();
    const observer = new ResizeObserver(compute);
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [items]);
  const shown = items.slice(0, fit), hidden = items.slice(fit);
  const hiddenActive = hidden.some((item) => isActivePath(pathname, item.to));
  const itemClass = (active: boolean) => cn(linkBase, 'h-10 px-2.5', active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground/80 hover:bg-muted hover:text-foreground');

  return <div ref={container} className="relative hidden min-w-0 flex-1 justify-end md:flex">
    <nav id="primary-navigation" className="top-nav flex items-center gap-1" aria-label="Main navigation" inert={inert}>
      {shown.map(({ to, label, Icon, motion }) => <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} className={({ isActive }) => itemClass(isActive)}>
        <Icon {...iconProps(motion)} /><span>{label}</span>
      </NavLink>)}
      {hidden.length > 0 && <DropdownMenu>
        <DropdownMenuTrigger className={cn(itemClass(hiddenActive), 'data-popup-open:bg-muted data-popup-open:text-foreground', hiddenActive && 'data-popup-open:bg-primary data-popup-open:text-primary-foreground')}>
          <Ellipsis className="size-[18px]" aria-hidden="true" /><span>More</span>
          {hiddenActive && <span className="sr-only">(current page is in this menu)</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 p-1.5" sideOffset={8}>
          {hidden.map(({ to, label, Icon, motion }) => <DropdownMenuItem key={to} className="min-h-10 px-2.5" render={<NavLink to={to} end={to === '/'} onClick={onNavigate} />}>
            <Icon {...iconProps(motion)} /><span>{label}</span>{isActivePath(pathname, to) && <span className="sr-only">(current page)</span>}
          </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>}
    </nav>
    {/* Invisible copy used only to measure natural widths. */}
    <div ref={measure} aria-hidden="true" inert className="pointer-events-none invisible absolute right-0 top-0 -z-10 flex gap-1">
      {items.map(({ to, label, Icon }) => <span key={to} className={cn(linkBase, 'h-10 px-2.5')}><Icon className="size-[18px]" /><span>{label}</span></span>)}
      <span className={cn(linkBase, 'h-10 px-2.5')}><Ellipsis className="size-[18px]" /><span>More</span></span>
    </div>
  </div>;
}

/** Slide-in navigation used below 768px by both layouts. */
export function MobileNav({ items, open, onOpenChange, trigger, mainRef, inert }: {
  items: Item[]; open: boolean; onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>; mainRef: RefObject<HTMLElement | null>; inert: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const navigated = useRef(false);
  // After a link closes the sheet, focus the page once the dialog has fully released focus.
  const settled = (isOpen: boolean) => { if (!isOpen && navigated.current) mainRef.current?.focus(); };
  return <Sheet open={open} onOpenChange={(next) => { if (next) navigated.current = false; onOpenChange(next); }} onOpenChangeComplete={settled}>
    <SheetContent side="left" showCloseButton={false} className="w-72 max-w-[85vw] p-0 data-[side=left]:sm:max-w-72"
      initialFocus={() => nav.current?.querySelector<HTMLElement>('a') ?? true}
      finalFocus={() => (navigated.current ? false : trigger.current ?? true)}>
      <SheetHeader className="flex-row items-center gap-2.5 border-b p-4">
        <span className="grid size-7 place-items-center text-foreground"><StockLedgerMark /></span>
        <SheetTitle className="font-heading text-lg font-bold tracking-tight">StockLedger</SheetTitle>
        <SheetDescription className="sr-only">Navigate between sections of your workspace.</SheetDescription>
      </SheetHeader>
      <nav ref={nav} className="top-nav grid gap-1 overflow-y-auto p-3" aria-label="Main navigation" inert={inert}>
        {items.map(({ to, label, Icon, motion }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => { navigated.current = true; onOpenChange(false); }}
          className={({ isActive }) => cn(linkBase, 'min-h-11 px-3', isActive ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted hover:text-foreground')}>
          <Icon {...iconProps(motion)} /><span>{label}</span>
        </NavLink>)}
      </nav>
      <SheetClose render={<Button variant="ghost" size="icon" className="absolute right-2 top-3 size-11" aria-label="Close navigation" />}><X aria-hidden="true" /></SheetClose>
    </SheetContent>
  </Sheet>;
}

/** Brand and collapse toggle at the top of the sidebar. */
export function SidebarHeaderRow({ onNavigate }: { onNavigate: () => void }) {
  const { toggleSidebar, state } = useSidebar();
  const collapsed = state === 'collapsed';
  return <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col">
    <NavLink to="/" aria-label="StockLedger home" onClick={onNavigate} className="brand flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-1.5 font-heading text-lg font-bold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="brand-mark"><StockLedgerMark /></span><span className="truncate group-data-[collapsible=icon]:hidden">StockLedger</span>
    </NavLink>
    <Button variant="ghost" size="icon" className="size-10 shrink-0 pointer-coarse:size-11" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-keyshortcuts="Control+B Meta+B" title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl/Cmd+B)`}>
      <PanelLeft aria-hidden="true" />
    </Button>
  </div>;
}

/** Collapsible sidebar menu (desktop). Collapses to an icon rail with tooltips. */
export function SidebarNav({ items, inert }: { items: Item[]; inert: boolean }) {
  const { pathname } = useLocation();
  return <nav className="top-nav min-h-0 flex-1" aria-label="Main navigation" inert={inert}>
    <SidebarMenu>
      {items.map(({ to, label, Icon, motion }) => <SidebarMenuItem key={to}>
        <SidebarMenuButton isActive={isActivePath(pathname, to)} tooltip={label} render={<NavLink to={to} end={to === '/'} className="nav-link" />}
          className="h-10 gap-2.5 px-3 text-sm font-medium text-foreground/80 data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:hover:bg-sidebar-primary data-active:hover:text-sidebar-primary-foreground pointer-coarse:h-11 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:[&>span]:sr-only pointer-coarse:group-data-[collapsible=icon]:size-11!">
          <Icon {...iconProps(motion)} /><span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu>
  </nav>;
}
