import { InventoryDateRangeFilter } from '../../components/inventory-date-range-filter';
import { useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { EmptyState, LocationFilter, PageHeader, PageState, Panel, PhoneStockRows, StockTable } from '../../components/inventory-ui';
import { MotionTabs } from '../../components/ui/motion-tabs';
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
  const { snapshot } = useInventoryStore();
  const { terms } = useCompanySettings();
  const [params, setParams] = useSearchParams();
  const tab: ReportTab = params.get('tab') in labels ? params.get('tab') as ReportTab : 'current';
  const setTab = (next: ReportTab) => setParams({ tab: next });
  const itemId = params.get('item');
  const placeId = params.get('place');
  const positions = snapshot?.positions ?? [];
  const rows = filterRows(positions, tab).filter(position => (!itemId || position.item.id === itemId) && (!placeId || position.location.id === placeId));

  return <PageState>
    <PageHeader title="Reports" actions={<><LocationFilter /><InventoryDateRangeFilter /></>} />
    <ReportTabs tab={tab} setTab={setTab} positions={positions} />
    {(itemId || placeId) && <section className="panel alert-context" aria-label="Selected stock alert"><p><b>{rows[0]?.item.name ?? snapshot?.items.find(item => item.id === itemId)?.name ?? 'Selected item'}</b> · {snapshot?.locations.find(place => place.id === placeId)?.name ?? 'Selected place'}</p><p>Showing the stock line from your alert.</p><div className="actions"><NavLink className="button" to={`/movements?item=${encodeURIComponent(itemId ?? '')}&place=${encodeURIComponent(placeId ?? '')}`}>Receive stock</NavLink><NavLink className="button secondary" to={`/movements?type=transfer&item=${encodeURIComponent(itemId ?? '')}&destination=${encodeURIComponent(placeId ?? '')}`}>Move stock here</NavLink><button className="button secondary" onClick={() => setParams({ tab: 'low' })}>View all low stock</button></div></section>}
    <Panel title={labels[tab]} subtitle={tab === 'low' ? 'At or below reorder level, using current stock at each place.' : tab === 'current' ? 'Closing stock includes every receipt and deduction recorded in the ledger, whatever period is selected.' : periodHint}>
      {rows.length ? tab === 'current' || tab === 'low' ? <StockTable positions={rows} /> : <OperationsVelocityTable positions={rows} /> : <EmptyState text={`No ${terms.items} in this report.`} />}
    </Panel>
  </PageState>;
}

export function ShopReportsPage() {
  const { snapshot } = useInventoryStore();
  const { terms } = useCompanySettings();
  const [tab, setTab] = useState<ReportTab>('current');
  const positions = snapshot?.positions ?? [];
  const rows = filterRows(positions, tab);

  return <PageState>
    <PageHeader title={`${terms.Shop} reports`} actions={<InventoryDateRangeFilter />} />
    <ReportTabs tab={tab} setTab={setTab} positions={positions} />
    <Panel title={labels[tab]} subtitle={tab === 'current' ? 'Opening stock, units in, units out, and what remains on the shelf, whatever period is selected.' : periodHint}>
      {rows.length ? <ShopReportTable positions={rows} current={tab === 'current'} /> : <EmptyState text={`No ${terms.items} in this report.`} />}
    </Panel>
  </PageState>;
}

const periodHint = 'Based on units sold or transferred out during the selected period.';

function filterRows(positions: Position[], tab: ReportTab) {
  return positions.filter((position) => tab === 'current' || (tab === 'low' ? position.isLowStock : position.velocity === tab));
}

function ReportTabs({ tab, setTab, positions }: { tab: ReportTab; setTab: (tab: ReportTab) => void; positions: Position[] }) {
  const items = (Object.keys(labels) as ReportTab[]).map((key) => {
    const count = key === 'current' ? positions.length : positions.filter((position) => key === 'low' ? position.isLowStock : position.velocity === key).length;
    return { value: key, label: `${labels[key]} (${count})` };
  });
  return <MotionTabs aria-label="Inventory report" items={items} onValueChange={setTab} value={tab} />;
}

function OperationsVelocityTable({ positions }: { positions: Position[] }) {
  const { money, calendarDate, terms } = useCompanySettings();
  return <div className="table-wrap"><table><thead><tr><th>{terms.Item}</th><th>Place</th><th className="num">Units out</th><th className="num">Closing</th><th className="num">Value held</th><th className="num">Last time out</th></tr></thead><tbody>{positions.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td className="num">{position.outLastPeriod}</td><td className="num">{position.closing}</td><td className="num">{money(position.valueCents)}</td><td className="num">{position.lastOutDate ? calendarDate(position.lastOutDate) : 'Never'}</td></tr>)}</tbody></table></div>;
}

function ShopReportTable({ positions, current }: { positions: Position[]; current: boolean }) {
  const { calendarDate, terms } = useCompanySettings();
  return <>{current && <PhoneStockRows positions={positions} />}<div className={`table-wrap ${current ? 'desktop-stock-table' : ''}`}><table><thead><tr><th>{terms.Item}</th>{current && <><th className="num">Opening</th><th className="num">In</th></>}<th className="num">Units out</th><th className="num">Closing</th>{!current && <th className="num">Last time out</th>}</tr></thead><tbody>{positions.map((position) => <tr key={position.item.id}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td>{current && <><td className="num">{position.opening}</td><td className="num positive">+{position.purchases + position.returnsIn + position.transferredIn + position.adjustmentsIn}</td></>}<td className="num negative">−{position.transferredOut + position.returnsOut + position.damaged + position.sales + position.adjustmentsOut}</td><td className="num"><b>{position.closing}</b>{position.isLowStock && <span className="badge">low</span>}</td>{!current && <td className="num">{position.lastOutDate ? calendarDate(position.lastOutDate) : 'Never'}</td>}</tr>)}</tbody></table></div></>;
}
