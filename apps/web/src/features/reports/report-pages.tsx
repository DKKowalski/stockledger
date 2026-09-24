import { useState } from 'react';
import { useInventoryStore } from '../../app/inventory-store';
import { EmptyState, LocationFilter, PageHeader, PageState, Panel, SelectControl, StockTable } from '../../components/inventory-ui';
import { formatDate, money } from '../../lib/presentation';
import type { Position } from '../../types';

type ReportTab = 'current' | 'low' | 'fast' | 'slow' | 'dead';

const labels: Record<ReportTab, string> = {
  current: 'Current stock',
  low: 'Low stock',
  fast: 'Fast movers',
  slow: 'Slow movers',
  dead: 'Dead stock',
};

export function OperationsReportsPage() {
  const { snapshot, days, setDays } = useInventoryStore();
  const [tab, setTab] = useState<ReportTab>('current');
  const positions = snapshot?.positions ?? [];
  const rows = filterRows(positions, tab);

  return <PageState>
    <PageHeader title="Reports" subtitle={`Sales and transfers out of each place over the last ${days} days.`} actions={<><LocationFilter /><PeriodFilter days={days} setDays={setDays} /></>} />
    <ReportTabs tab={tab} setTab={setTab} positions={positions} />
    <Panel title={labels[tab]} subtitle={tab === 'current' ? 'Closing stock includes every receipt and deduction recorded in the ledger.' : undefined}>
      {rows.length ? tab === 'current' ? <StockTable positions={rows} /> : <OperationsVelocityTable positions={rows} /> : <EmptyState text="No items in this report." />}
    </Panel>
  </PageState>;
}

export function ShopReportsPage() {
  const { snapshot, days, setDays } = useInventoryStore();
  const [tab, setTab] = useState<ReportTab>('current');
  const positions = snapshot?.positions ?? [];
  const rows = filterRows(positions, tab);
  const shop = snapshot?.locations.find((place) => place.id === snapshot.locationId);

  return <PageState>
    <PageHeader title="Shop reports" subtitle={`Stock activity at ${shop?.name ?? 'your assigned shop'} over the last ${days} days.`} actions={<PeriodFilter days={days} setDays={setDays} />} />
    <ReportTabs tab={tab} setTab={setTab} positions={positions} />
    <Panel title={labels[tab]} subtitle={tab === 'current' ? 'Opening stock, units in, units out, and what remains on the shelf.' : undefined}>
      {rows.length ? <ShopReportTable positions={rows} current={tab === 'current'} /> : <EmptyState text="No items in this report." />}
    </Panel>
  </PageState>;
}

function filterRows(positions: Position[], tab: ReportTab) {
  return positions.filter((position) => tab === 'current' || (tab === 'low' ? position.isLowStock : position.velocity === tab));
}

function PeriodFilter({ days, setDays }: { days: number; setDays: (days: number) => void }) {
  return <SelectControl
    aria-label="Reporting period"
    onValueChange={(value) => setDays(Number(value))}
    options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]}
    value={String(days)}
  />;
}

function ReportTabs({ tab, setTab, positions }: { tab: ReportTab; setTab: (tab: ReportTab) => void; positions: Position[] }) {
  return <div className="tabs" role="tablist">{(Object.keys(labels) as ReportTab[]).map((key) => {
    const count = key === 'current' ? positions.length : positions.filter((position) => key === 'low' ? position.isLowStock : position.velocity === key).length;
    return <button role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{labels[key]} ({count})</button>;
  })}</div>;
}

function OperationsVelocityTable({ positions }: { positions: Position[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th className="num">Units out</th><th className="num">Closing</th><th className="num">Value held</th><th className="num">Last time out</th></tr></thead><tbody>{positions.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td className="num">{position.outLastPeriod}</td><td className="num">{position.closing}</td><td className="num">{money(position.valueCents)}</td><td className="num">{position.lastOutDate ? formatDate(position.lastOutDate) : 'Never'}</td></tr>)}</tbody></table></div>;
}

function ShopReportTable({ positions, current }: { positions: Position[]; current: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Item</th>{current && <><th className="num">Opening</th><th className="num">In</th></>}<th className="num">Units out</th><th className="num">Closing</th>{!current && <th className="num">Last time out</th>}</tr></thead><tbody>{positions.map((position) => <tr key={position.item.id}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td>{current && <><td className="num">{position.opening}</td><td className="num positive">+{position.purchases + position.returnsIn + position.transferredIn}</td></>}<td className="num negative">−{position.transferredOut + position.returnsOut + position.damaged + position.sales}</td><td className="num"><b>{position.closing}</b>{position.isLowStock && <span className="badge">low</span>}</td>{!current && <td className="num">{position.lastOutDate ? formatDate(position.lastOutDate) : 'Never'}</td>}</tr>)}</tbody></table></div>;
}
