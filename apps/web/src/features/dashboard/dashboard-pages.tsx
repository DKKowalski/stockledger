import { InventoryDateRangeFilter } from '../../components/inventory-date-range-filter';
import { ArrowLeftRight, ArrowUpRight, Check, ChevronRight, PackageX, ShoppingBag, TrendingUp, TriangleAlert, Warehouse } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { EmptyState, Kpi, LocationFilter, PageHeader, PageState, Panel } from '../../components/inventory-ui';
import { LedgerSyncIcon } from '../../components/ledger-sync-icon';
import { movementMeta } from '../../lib/presentation';
import type { Movement, Position, Snapshot, Profitability } from '../../types';
import { OwnerSetupChecklist } from '../onboarding/owner-setup-checklist';
import { DealsAttendantNotice, DealsWhatsNew } from '../../components/deals-tour';
import { useAuth } from '../../auth-context';
import { api } from '../../api';
import { companyDay } from '../../lib/date-range';

export function OperationsDashboardPage() {
  const { snapshot, refresh, loading } = useInventoryStore();
  const { user } = useAuth();
  return <PageState>{snapshot && <DashboardBody
    title="Inventory"
    accent="overview"
    actions={<><InventoryDateRangeFilter /><LocationFilter /><InventorySyncButton loading={loading} refresh={refresh} /><NavLink className="button" to="/movements">Record movement<ArrowUpRight size={16} /></NavLink></>}
    positions={snapshot.positions}
    movements={snapshot.periodMovements}
    summary={snapshot.summary}
    setup={<><OwnerSetupChecklist />{user?.role === 'administrator' && snapshot.positions.some(position => position.closing > 0 && position.item.isActive && position.item.sellingPriceCents != null && position.item.sellingPriceCents > 0) && <DealsWhatsNew />}</>}
  />}</PageState>;
}

export function ShopDashboardPage() {
  const { snapshot, refresh, loading } = useInventoryStore();
  const { money, calendarDate, terms } = useCompanySettings();
  if (!snapshot) return <PageState><></></PageState>;
  const shop = snapshot.locations.find((place) => place.id === snapshot.locationId);
  const sales = snapshot.periodMovements.filter((movement) => movement.type === 'sale');
  const revenue = sales.reduce((total, sale) => total + (sale.saleTotalCents ?? 0), 0);
  const unitsSold = sales.reduce((total, sale) => total + sale.quantity, 0);
  return <PageState>
    <PageHeader title={shop?.name ?? `Your ${terms.shop}`} actions={<><InventoryDateRangeFilter /><InventorySyncButton loading={loading} refresh={refresh} /><NavLink className="button" to="/sell">Sell<ArrowUpRight size={16} /></NavLink></>} />
    <DealsAttendantNotice />
    <section className="kpi-grid">
      <Kpi icon={Warehouse} label="Stock on hand" value={snapshot.summary.closingUnits.toLocaleString()} note={`${snapshot.positions.length} stocked ${terms.item} lines`} />
      <Kpi icon={ShoppingBag} label="Units sold" value={unitsSold.toLocaleString()} note="During the selected period" tone="success" />
      <Kpi icon={TrendingUp} label="Recorded revenue" value={money(revenue)} note="Sales with recorded prices" amount />
      <Kpi icon={TriangleAlert} label={`Low stock ${terms.items}`} value={String(snapshot.summary.lowStockItems)} note="At or below reorder level" tone="warning" />
    </section>
    <section className="dashboard-grid">
      <Panel title="Sales in this period" className="movement-panel">
        {sales.length ? <div className="movement-list">{sales.slice(0, 6).map((sale) => <div className="movement-row" key={sale.id}>
          <span className="movement-icon out"><ShoppingBag size={15} /></span>
          <div><b>{sale.item?.name ?? `Deleted ${terms.item}`}</b><small>{calendarDate(sale.movementDate)} · {sale.saleTotalCents == null ? 'Price not recorded' : money(sale.saleTotalCents)}</small></div>
          <strong className="negative">−{sale.quantity}</strong>
        </div>)}</div> : <EmptyState text="No sales recorded yet." />}
      </Panel>
      <Panel title="Attention needed" subtitle={`${terms.Items} at or below reorder level`}><LowStock positions={snapshot.positions} /></Panel>
    </section>
    <section className="insights-grid"><StockLevels positions={snapshot.positions} /><StockHealth positions={snapshot.positions} /></section>
  </PageState>;
}

function InventorySyncButton({ loading, refresh }: { loading: boolean; refresh: () => Promise<void> }) {
  return <button
    aria-busy={loading}
    className={`button inventory-sync-button ${loading ? 'is-loading' : ''}`}
    disabled={loading}
    onClick={() => void refresh()}
    type="button"
  >
    <LedgerSyncIcon active={loading} />
    <span className="inventory-sync-label" aria-live="polite">{loading ? 'Syncing' : 'Sync stock'}</span>
  </button>;
}

function DashboardBody({ title, accent, actions, positions, movements, summary, setup }: {
  title: string;
  accent?: string;
  actions: ReactNode;
  positions: Position[];
  movements: Movement[];
  summary: Snapshot['summary'];
  setup?: ReactNode;
}) {
  const { money, calendarDate, terms } = useCompanySettings();
  const { user } = useAuth();
  const owner = user?.role === 'administrator';
  return <>
    <PageHeader title={title} accent={accent} actions={owner ? undefined : actions} />
    {setup}
    {owner && <><OwnerTodayMoney /><div className="actions dashboard-controls">{actions}</div></>}
    <section className="kpi-grid">
      <Kpi icon={Warehouse} label="Closing stock" value={summary.closingUnits.toLocaleString()} note={`${money(summary.stockValueCents)} at cost`} />
      <Kpi icon={TriangleAlert} label={`Low stock ${terms.items}`} value={String(summary.lowStockItems)} note="At or below reorder level" tone="warning" />
      <Kpi icon={PackageX} label="Damaged units" value={summary.damagedUnits.toLocaleString()} note="Written off to date" tone="danger" />
      <Kpi icon={TrendingUp} label="Dead stock lines" value={String(summary.deadStockLines)} note="No sale or transfer out in the selected period" tone="success" />
    </section>
    <section className="insights-grid"><StockLevels positions={positions} /><StockHealth positions={positions} /></section>
    <section className="dashboard-grid">
      <Panel title="Movements in this period" className="movement-panel">
        {movements.length ? <div className="movement-list">{movements.slice(0, 6).map((movement) => <div className="movement-row" key={movement.id}>
          <span className={`movement-icon ${movement.sign === 1 ? 'in' : 'out'}`}><ArrowLeftRight size={15} /></span>
          <div><b>{movement.item?.name ?? `Deleted ${terms.item}`}</b><small>{movementMeta[movement.type].label} · {calendarDate(movement.movementDate)}</small></div>
          <strong className={movement.sign === 1 ? 'positive' : 'negative'}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</strong>
        </div>)}</div> : <EmptyState text="No movements recorded yet." />}
      </Panel>
      <Panel title="Attention needed" subtitle={`${terms.Items} at or below reorder level`}><LowStock positions={positions} /></Panel>
    </section>
  </>;
}

function OwnerTodayMoney() {
  const { user, accessToken } = useAuth();
  const { snapshot, locationId } = useInventoryStore();
  const { settings, money, calendarDate } = useCompanySettings();
  const today = companyDay(settings?.timeZone);
  const [answer, setAnswer] = useState<{ scope: string; report: Profitability } | null>(null);
  const [failed, setFailed] = useState(false);
  const scope = `${today}:${locationId ?? ''}`;
  const generatedAt = snapshot?.generatedAt;
  useEffect(() => {
    if (user?.role !== 'administrator' || !accessToken || !settings) return;
    let active = true;
    void api.profitability(accessToken, { days: 30, from: today, to: today, ...(locationId ? { locationId } : {}) })
      .then(report => { if (active) { setAnswer({ scope, report }); setFailed(false); } })
      .catch(() => { if (active) { setAnswer(null); setFailed(true); } });
    return () => { active = false; };
  }, [user?.role, accessToken, settings, today, locationId, scope, generatedAt]);
  if (user?.role !== 'administrator') return null;
  const summary = answer?.scope === scope ? answer.report.summary : null;
  return <section className="panel today-money" aria-label="Today's recorded money">
    <div><h2>Today’s money</h2><p>{calendarDate(today)} · {snapshot?.locations.find(place => place.id === locationId)?.name ?? 'All places'}</p></div>
    {summary ? <><dl><div><dt>Recorded net sales</dt><dd>{money(summary.netSalesCents)}</dd></div><div><dt>Gross profit</dt><dd>{money(summary.grossProfitCents)}</dd></div></dl><p>Sales after discounts and returns. Gross profit excludes expenses and sales without a known cost; this is not cash collected.{summary.costCoveragePercent < 100 && ` Cost coverage: ${summary.costCoveragePercent}%.`}</p></> : <p role="status">{failed ? 'Today’s money could not load.' : 'Loading today’s money…'}</p>}
    <NavLink className="text-button" to="/profitability">Open Profit<ChevronRight size={15} /></NavLink>
  </section>;
}

function StockLevels({ positions }: { positions: Position[] }) {
  const { terms } = useCompanySettings();
  const rows = [...positions].sort((a, b) => b.closing - a.closing).slice(0, 5);
  const series = rows.map((position) => ({ position, values: [
    { key: 'opening', label: 'Opening', value: position.opening },
    { key: 'in', label: 'Stock in', value: position.purchases + position.returnsIn + position.transferredIn + position.adjustmentsIn },
    { key: 'out', label: 'Stock out', value: position.transferredOut + position.returnsOut + position.damaged + position.sales + position.adjustmentsOut },
    { key: 'closing', label: 'Closing', value: position.closing },
  ] }));
  const max = Math.max(...series.flatMap(({ values }) => values.map(({ value }) => value)), 1);
  return <Panel title="Most stock held, by item and place" className="stock-chart-panel">
    {rows.length ? <><ol className="stock-ranked-list" aria-label="Stock held and movement details">{series.map(({ position, values }) => <li key={`${position.location.id}-${position.item.id}`}><details><summary><span><b>{position.item.name}</b><small>{position.location.name} · {position.item.sku}</small></span><strong>{position.closing} {position.item.unit}</strong></summary><dl>{values.map(value => <div key={value.key}><dt>{value.label}</dt><dd>{value.value} {position.item.unit}</dd></div>)}</dl></details></li>)}</ol><div className="stock-chart" aria-hidden="true"><div className="chart-toolbar"><div className="chart-legend"><span><i className="opening" />Opening</span><span><i className="in" />In</span><span><i className="out" />Out</span><span><i className="closing" />Closing</span></div></div><div className="chart-grid-lines"><i /><i /><i /><i /></div><div className="chart-bars">{series.map(({ position, values }) => <div className="chart-group" key={`${position.location.id}-${position.item.id}`}><div className="chart-group-bars">{values.map(({ key, label, value }) => <span className={`chart-bar ${key}`} key={key} title={`${label}: ${value}`} style={{ height: `${(value / max) * 100}%` }}>{key === 'closing' && value !== 0 && <b>{value}</b>}</span>)}</div><small>{position.item.name}<br />{position.location.name}</small></div>)}</div></div></> : <EmptyState text={`Add ${terms.items} to see stock levels.`} />}
  </Panel>;
}

function StockHealth({ positions }: { positions: Position[] }) {
  const { terms } = useCompanySettings();
  const total = positions.length;
  if (!total) return <Panel title="Inventory health" className="health-panel"><div className="health-empty">Stock health will appear after you add stock.</div></Panel>;
  const low = positions.filter((position) => position.isLowStock).length;
  const healthy = Math.max(total - low, 0);
  const healthPercent = total ? Math.round((healthy / total) * 100) : 0;
  const lowPercent = total ? 100 - healthPercent : 0;
  return <Panel title="Inventory health" className="health-panel"><div className="health-body"><div className="health-metric"><strong>{healthy} of {total}</strong><span>stock lines above reorder level</span><small>{healthPercent}% of tracked lines</small></div><div className="health-chart-row"><div className="health-gauge" role="img" aria-label={`${healthy} of ${total} stock lines above reorder level (${healthPercent}%)`}><svg key={`${healthPercent}-${lowPercent}`} viewBox="0 0 240 126" aria-hidden="true"><path className="gauge-track" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" /><path className="gauge-healthy" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" strokeDasharray={`${healthPercent} ${100 - healthPercent}`} />{lowPercent > 0 && <path className="gauge-low" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" strokeDasharray={`${lowPercent} ${100 - lowPercent}`} strokeDashoffset={-healthPercent} />}</svg><span>Stock health</span></div><div className="health-legend"><div><span className="legend-dot healthy" /><p><b>Above reorder level</b><small>{healthy} {terms.item} lines</small></p></div><div><span className="legend-dot low" /><p><b>Low stock</b><small>{low} {terms.item} lines</small></p></div></div></div></div><NavLink className="panel-link" to="/reports">View stock report <ChevronRight size={15} /></NavLink></Panel>;
}

function LowStock({ positions }: { positions: Position[] }) {
  const { terms } = useCompanySettings();
  if (!positions.length) return <EmptyState text="Add stock to see which lines need attention." />;
  const rows = positions.filter((position) => position.isLowStock).slice(0, 5);
  if (!rows.length) return <div className="all-clear"><span><Check size={17} /></span><div><b>All levels look good</b><small>No {terms.items} need reordering.</small></div></div>;
  return <div className="low-stock-list">{rows.map((position) => { const percent = Math.min((position.closing / Math.max(position.item.reorderLevel, 1)) * 100, 100); return <div className="low-stock-row" key={`${position.location.id}-${position.item.id}`}><div><b>{position.item.name}</b><small>{position.location.name} · {position.closing} of {position.item.reorderLevel} {position.item.unit}</small></div><span className="stock-progress"><i style={{ width: `${percent}%` }} /></span></div>; })}</div>;
}
