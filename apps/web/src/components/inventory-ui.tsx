import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useInventoryStore } from '../app/inventory-store';
import { useCompanySettings } from '../app/company-settings-store';
import type { Position } from '../types';
import { EmptyInventoryIcon } from './animated-icons';
import { StockLedgerMark } from './stockledger-mark';
import { SelectControl } from './ui/select-control';

export { SelectControl } from './ui/select-control';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="actions">{actions}</div>}</div>;
}

export function PageState({ children }: { children: ReactNode }) {
  const { loading, snapshot } = useInventoryStore();
  if (loading && !snapshot) return <div className="empty page-state"><StockLedgerMark animated size={40} /><p>Loading inventory</p></div>;
  return children;
}

export function EmptyState({ text, icon }: { text: string; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <EmptyInventoryIcon />}<p>{text}</p></div>;
}

export function Kpi({ icon: Icon, label, value, note, tone = '' }: { icon: LucideIcon; label: string; value: string; note: string; tone?: string }) {
  return <article className="panel kpi">
    <div className="kpi-top"><p>{label}</p><span className={`kpi-icon ${tone}`}><Icon size={19} /></span></div>
    <strong>{value}</strong>
    <small>{note}</small>
  </article>;
}

export function Panel({ title, subtitle, className = '', children }: { title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`}><div className="panel-header"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children}</section>;
}

export function LocationFilter() {
  const { snapshot, locationId, setLocationId } = useInventoryStore();
  if (!snapshot) return null;
  return <SelectControl
    aria-label="Place"
    onValueChange={(value) => setLocationId(value || null)}
    options={[{ value: '', label: 'All places' }, ...snapshot.locations.map((place) => ({ value: place.id, label: place.name }))]}
    value={locationId ?? ''}
  />;
}

export function StockTable({ positions, compact = false }: { positions: Position[]; compact?: boolean }) {
  const { money } = useCompanySettings();
  const showPlace = new Set(positions.map((position) => position.location.id)).size > 1;
  return <div className="table-wrap"><table><thead><tr><th>Item</th>{showPlace && <th>Place</th>}<th className="num">Opening</th>{!compact && <><th className="num">Purchases</th><th className="num">Returns in</th></>}<th className="num">In</th><th className="num">Out</th><th className="num">Closing</th>{!compact && <th className="num">Value</th>}</tr></thead><tbody>{positions.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td>{showPlace && <td>{position.location.name}</td>}<td className="num">{position.opening}</td>{!compact && <><td className="num">{position.purchases}</td><td className="num">{position.returnsIn}</td></>}<td className="num positive">+{position.purchases + position.returnsIn + position.transferredIn + position.adjustmentsIn}</td><td className="num negative">−{position.transferredOut + position.returnsOut + position.damaged + position.sales + position.adjustmentsOut}</td><td className="num"><b>{position.closing}</b>{position.isLowStock && <span className="badge">low</span>}</td>{!compact && <td className="num">{money(position.valueCents)}</td>}</tr>)}</tbody></table></div>;
}
