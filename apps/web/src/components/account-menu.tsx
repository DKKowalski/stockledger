import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Power, UserRoundCog } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { roleLabel } from '../lib/presentation';
import { UserAvatar } from './user-avatar';

export function AccountMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return <Menu.Root>
    <Menu.Trigger className={`topbar-user ${location.pathname === '/account' ? 'active' : ''}`} aria-label="Open account menu">
      <UserAvatar name={user?.fullName ?? 'StockLedger'} />
      <span className="topbar-user-copy"><b>{user?.fullName}</b><small>{user ? roleLabel[user.role] : ''}</small></span>
      <ChevronDown className="account-menu-chevron" size={14} />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner className="account-menu-positioner" align="end" side="bottom" sideOffset={8}>
        <Menu.Popup className="account-menu-popup">
          <div className="account-menu-identity"><b>{user?.fullName}</b><span>{user?.email}</span></div>
          <div className="account-menu-separator" />
          <Menu.Item className="account-menu-item" onClick={() => navigate('/account')}><UserRoundCog size={17} /><span>Profile settings</span></Menu.Item>
          <Menu.Item className="account-menu-item danger" onClick={signOut}><Power size={17} /><span>Sign out</span></Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
