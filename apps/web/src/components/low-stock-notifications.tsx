import { Menu } from '@base-ui/react/menu';
import { Bell, CheckCircle2, PackageSearch } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useInventoryStore } from '../app/inventory-store';

export function LowStockNotifications() {
  const { snapshot } = useInventoryStore();
  const navigate = useNavigate();
  const lowStock = snapshot?.positions.filter((position) => position.isLowStock) ?? [];

  return <Menu.Root>
    <Menu.Trigger className="notification-trigger" aria-label={`${lowStock.length} low-stock ${lowStock.length === 1 ? 'alert' : 'alerts'}`}>
      <Bell size={18} />
      {lowStock.length > 0 && <span className="notification-badge">{lowStock.length > 9 ? '9+' : lowStock.length}</span>}
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner className="notification-positioner" align="end" side="bottom" sideOffset={8}>
        <Menu.Popup className="notification-popup">
          <div className="notification-heading"><div><b>Stock alerts</b><span>{lowStock.length ? `${lowStock.length} lines need attention` : 'Everything looks healthy'}</span></div><Bell size={17} /></div>
          {lowStock.length ? <div className="notification-list">{lowStock.slice(0, 6).map((position) => <Menu.Item className="notification-item" key={`${position.location.id}:${position.item.id}`} onClick={() => navigate('/reports')}>
            <span className="notification-item-icon"><PackageSearch size={16} /></span><span><b>{position.item.name}</b><small>{position.closing} {position.item.unit} at {position.location.name} · reorder at {position.item.reorderLevel}</small></span>
          </Menu.Item>)}</div> : <div className="notification-empty"><CheckCircle2 size={22} /><span>No low-stock items</span></div>}
          {lowStock.length > 6 && <Menu.Item className="notification-view-all" onClick={() => navigate('/reports')}>View all {lowStock.length} alerts</Menu.Item>}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
