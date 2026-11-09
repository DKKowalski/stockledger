import { Building2, ChevronDown, PanelLeft, PanelTop, Power, UserRoundCog } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { roleLabel } from '../lib/presentation';
import { saveNavLayout, useNavLayout, type NavLayout } from '../lib/nav-layout';
import { cn } from '@/lib/utils';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { UserAvatar } from './user-avatar';

export function AccountMenu({ variant = 'header', compact = false }: { variant?: 'header' | 'sidebar'; compact?: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useNavLayout();
  const inSidebar = variant === 'sidebar';
  const onAccountPage = ['/account', '/settings'].includes(location.pathname);

  return <DropdownMenu>
    <DropdownMenuTrigger
      aria-label="Open account menu"
      className={cn(
        'flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-transparent p-1 text-left text-foreground outline-none transition-colors hover:border-border hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring data-popup-open:border-border data-popup-open:bg-secondary md:min-h-10',
        onAccountPage && 'border-border bg-secondary',
        inSidebar && 'w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:[&>:not(:first-child)]:hidden',
      )}
    >
      <UserAvatar name={user?.fullName ?? 'StockLedger'} />
      <span className={cn('grid min-w-0 gap-px', !inSidebar && (compact ? 'max-[1535px]:hidden' : 'max-md:hidden'))}>
        <b className="truncate text-[11px]">{user?.fullName}</b>
        <small className="truncate text-[10px] text-muted-foreground">{user ? roleLabel[user.role] : ''}</small>
      </span>
      <ChevronDown className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform [[data-popup-open]>&]:rotate-180', !inSidebar && (compact ? 'max-[1535px]:hidden' : 'max-md:hidden'))} aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-60 p-1.5" align={inSidebar ? 'start' : 'end'} side={inSidebar ? 'top' : 'bottom'} sideOffset={8}>
      <div className="grid min-w-0 gap-0.5 px-2.5 pb-2.5 pt-2">
        <b className="truncate text-xs">{user?.fullName}</b>
        <span className="truncate text-[11px] text-muted-foreground">{user?.email}</span>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-10 px-2.5" onClick={() => navigate('/account')}><UserRoundCog /><span>Profile settings</span></DropdownMenuItem>
      {user?.role === 'administrator' && <DropdownMenuItem className="min-h-10 px-2.5" onClick={() => navigate('/settings')}><Building2 /><span>Business settings</span></DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Navigation layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={layout} onValueChange={(value) => saveNavLayout(value as NavLayout)}>
          <DropdownMenuRadioItem className="min-h-10 px-2.5" value="header"><PanelTop /><span>Header</span></DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="min-h-10 px-2.5" value="sidebar"><PanelLeft /><span>Sidebar</span></DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-10 px-2.5" variant="destructive" onClick={signOut}><Power /><span>Sign out</span></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
