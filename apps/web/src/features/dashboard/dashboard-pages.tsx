import { ArrowLeftRight, ArrowUpDown, ArrowUpRight, CalendarDays, Check, ChevronRight, PackageX, RefreshCw, ShoppingBag, TrendingUp, TriangleAlert, Warehouse } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useInventoryStore } from '../../app/inventory-store';
import { EmptyState, Kpi, LocationFilter, PageHeader, PageState, Panel } from '../../components/inventory-ui';
import { formatDate, money, movementMeta } from '../../lib/presentation';
import type { Movement, Position, Snapshot } from '../../types';

export function OperationsDashboardPage() {
  const { snapshot, refresh, loading } = useInventoryStore();
  return <PageState>{snapshot && <DashboardBody
    title="Inventory overview"
    subtitle={snapshot.locationId ? `Stock held at ${snapshot.locations.find((place) => place.id === snapshot.locationId)?.name}.` : 'Stock held across every place in the company.'}
    actions={<><LocationFilter /><RefreshButton loading={loading} refresh={refresh} /><NavLink className="button" to="/movements">Record movement<ArrowUpRight size={16} /></NavLink></>}
    positions={snapshot.positions}
    movements={snapshot.movements}
    periodDays={snapshot.periodDays}
    summary={snapshot.summary}
  />}</PageState>;
}

export function ShopDashboardPage() {
  const { snapshot, refresh, loading } = useInventoryStore();
  if (!snapshot) return <PageState><></></PageState>;
  const shop = snapshot.locations.find((place) => place.id === snapshot.locationId);
  const sales = snapshot.movements.filter((movement) => movement.type === 'sale');
  const revenue = sales.reduce((total, sale) => total + (sale.saleTotalCents ?? 0), 0);
  const unitsSold = sales.reduce((total, sale) => total + sale.quantity, 0);
  return <PageState>
    <PageHeader title={shop?.name ?? 'Your shop'} subtitle="Stock and sales for your assigned shop." actions={<><RefreshButton loading={loading} refresh={refresh} /><NavLink className="button" to="/sell">Sell<ArrowUpRight size={16} /></NavLink></>} />
    <section className="kpi-grid">
      <Kpi icon={Warehouse} label="Stock on hand" value={snapshot.summary.closingUnits.toLocaleString()} note={`${snapshot.positions.length} stocked item lines`} />
      <Kpi icon={ShoppingBag} label="Units sold" value={unitsSold.toLocaleString()} note={`During the last ${snapshot.periodDays} days`} tone="success" />
      <Kpi icon={TrendingUp} label="Recorded revenue" value={money(revenue)} note="Sales with recorded prices" />
      <Kpi icon={TriangleAlert} label="Low stock items" value={String(snapshot.summary.lowStockItems)} note="At or below reorder level" tone="warning" />
    </section>
    <section className="dashboard-grid">
      <Panel title="Recent sales" subtitle="Latest sales at this shop" className="movement-panel">
        {sales.length ? <div className="movement-list">{sales.slice(0, 6).map((sale) => <div className="movement-row" key={sale.id}>
          <span className="movement-icon out"><ShoppingBag size={15} /></span>
          <div><b>{sale.item?.name ?? 'Deleted item'}</b><small>{formatDate(sale.movementDate)} · {sale.saleTotalCents == null ? 'Price not recorded' : money(sale.saleTotalCents)}</small></div>
          <strong className="negative">−{sale.quantity}</strong>
        </div>)}</div> : <EmptyState text="No sales recorded yet." />}
      </Panel>
      <Panel title="Attention needed" subtitle="Items at or below reorder level"><LowStock positions={snapshot.positions} /></Panel>
    </section>
    <section className="insights-grid"><StockLevels positions={snapshot.positions} /><StockHealth positions={snapshot.positions} /></section>
  </PageState>;
}

function RefreshButton({ loading, refresh }: { loading: boolean; refresh: () => Promise<void> }) {
  return <button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} />Refresh</button>;
}

function DashboardBody({ title, subtitle, actions, positions, movements, periodDays, summary }: {
  title: string;
  subtitle: string;
  actions: ReactNode;
  positions: Position[];
  movements: Movement[];
  periodDays: number;
  summary: Snapshot['summary'];
}) {
  return <>
    <PageHeader title={title} subtitle={subtitle} actions={actions} />
    <section className="kpi-grid">
      <Kpi icon={Warehouse} label="Closing stock" value={summary.closingUnits.toLocaleString()} note={`${money(summary.stockValueCents)} at cost`} />
      <Kpi icon={TriangleAlert} label="Low stock items" value={String(summary.lowStockItems)} note="At or below reorder level" tone="warning" />
      <Kpi icon={PackageX} label="Damaged units" value={summary.damagedUnits.toLocaleString()} note="Written off to date" tone="danger" />
      <Kpi icon={TrendingUp} label="Dead stock lines" value={String(summary.deadStockLines)} note={`No sale or transfer out in ${periodDays} days`} tone="success" />
    </section>
    <section className="insights-grid"><StockLevels positions={positions} /><StockHealth positions={positions} /></section>
    <section className="dashboard-grid">
      <Panel title="Recent movements" subtitle="Latest stock activity" className="movement-panel">
        {movements.length ? <div className="movement-list">{movements.slice(0, 6).map((movement) => <div className="movement-row" key={movement.id}>
          <span className={`movement-icon ${movement.sign === 1 ? 'in' : 'out'}`}><ArrowLeftRight size={15} /></span>
          <div><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movementMeta[movement.type].label} · {formatDate(movement.movementDate)}</small></div>
          <strong className={movement.sign === 1 ? 'positive' : 'negative'}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</strong>
        </div>)}</div> : <EmptyState text="No movements recorded yet." />}
      </Panel>
      <Panel title="Attention needed" subtitle="Items at or below reorder level"><LowStock positions={positions} /></Panel>
    </section>
  </>;
}

function StockLevels({ positions }: { positions: Position[] }) {
  const rows = [...positions].sort((a, b) => b.closing - a.closing).slice(0, 5);
  const series = rows.map((position) => ({ position, values: [
    { key: 'opening', label: 'Opening', value: position.opening },
    { key: 'in', label: 'Stock in', value: position.purchases + position.returnsIn + position.transferredIn },
    { key: 'out', label: 'Stock out', value: position.transferredOut + position.returnsOut + position.damaged + position.sales },
    { key: 'closing', label: 'Closing', value: position.closing },
  ] }));
  const max = Math.max(...series.flatMap(({ values }) => values.map(({ value }) => value)), 1);
  return <Panel title="Stock movement" subtitle="Opening, inbound, outbound, and closing units" className="stock-chart-panel">
    {rows.length ? <div className="stock-chart"><div className="chart-toolbar"><div className="chart-legend" aria-label="Chart legend"><span><i className="opening" />Opening</span><span><i className="in" />In</span><span><i className="out" />Out</span><span><i className="closing" />Closing</span></div><span className="chart-period"><CalendarDays size={14} />Top 5 items</span></div><div className="chart-grid-lines"><i /><i /><i /><i /></div><div className="chart-bars">{series.map(({ position, values }) => <div className="chart-group" key={`${position.location.id}-${position.item.id}`} title={`${position.item.name} · ${position.location.name}`}><div className="chart-group-bars">{values.map(({ key, label, value }) => <span className={`chart-bar ${key}`} key={key} title={`${label}: ${value}`} style={{ height: `${Math.max((value / max) * 100, 4)}%` }}>{key === 'closing' && <b>{value}</b>}</span>)}</div><small>{position.item.sku.replace('SKU-', '')}</small></div>)}</div></div> : <EmptyState text="Add items to see stock levels." />}
  </Panel>;
}

function StockHealth({ positions }: { positions: Position[] }) {
  const total = positions.length;
  const low = positions.filter((position) => position.isLowStock).length;
  const healthy = Math.max(total - low, 0);
  const healthPercent = total ? Math.round((healthy / total) * 100) : 0;
  const lowPercent = total ? 100 - healthPercent : 0;
  return <Panel title="Inventory health" subtitle="Availability across all item lines" className="health-panel"><div className="health-body"><div className="health-metric"><strong>{healthPercent}%</strong><span>availability</span><small><ArrowUpDown size={12} />{total} tracked lines</small></div><div className="health-chart-row"><div className="health-gauge" role="img" aria-label={`${healthPercent}% of inventory lines are healthy`}><svg viewBox="0 0 240 126" aria-hidden="true"><path className="gauge-track" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" /><path className="gauge-healthy" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" strokeDasharray={`${healthPercent} ${100 - healthPercent}`} />{lowPercent > 0 && <path className="gauge-low" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" strokeDasharray={`${lowPercent} ${100 - lowPercent}`} strokeDashoffset={-healthPercent} />}</svg><span>Stock health</span></div><div className="health-legend"><div><span className="legend-dot healthy" /><p><b>In good standing</b><small>{healthy} item lines</small></p></div><div><span className="legend-dot low" /><p><b>Low stock</b><small>{low} item lines</small></p></div></div></div></div><NavLink className="panel-link" to="/reports">View stock report <ChevronRight size={15} /></NavLink></Panel>;
}

function LowStock({ positions }: { positions: Position[] }) {
  const rows = positions.filter((position) => position.isLowStock).slice(0, 5);
  if (!rows.length) return <div className="all-clear"><span><Check size={17} /></span><div><b>All levels look good</b><small>No items need reordering.</small></div></div>;
  return <div className="low-stock-list">{rows.map((position) => { const percent = Math.min((position.closing / Math.max(position.item.reorderLevel, 1)) * 100, 100); return <div className="low-stock-row" key={`${position.location.id}-${position.item.id}`}><div><b>{position.item.name}</b><small>{position.location.name} · {position.closing} of {position.item.reorderLevel} {position.item.unit}</small></div><span className="stock-progress"><i style={{ width: `${percent}%` }} /></span></div>; })}</div>;
}
