import { Building2, CircleDollarSign, PackageX, Percent, ReceiptText, SlidersHorizontal, Store, TrendingUp, Warehouse as WarehouseIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ApiError, api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, Kpi, PageHeader, Panel, SelectControl } from '../../components/inventory-ui';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { LocationType, Profitability } from '../../types';

type LocationScope = '' | LocationType;
type ProfitPeriod = 7 | 30 | 90;

export function ProfitabilityPage() {
  const { accessToken, signOut } = useAuth();
  const { snapshot } = useInventoryStore();
  const { money, calendarDate } = useCompanySettings();
  const [days, setDays] = useState<ProfitPeriod>(30);
  const [locationType, setLocationType] = useState<LocationScope>('');
  const [locationId, setLocationId] = useState('');
  const [category, setCategory] = useState('');
  const [itemId, setItemId] = useState('');
  const [report, setReport] = useState<Profitability | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locations = useMemo(() => (snapshot?.locations ?? [])
    .filter((location) => !locationType || location.type === locationType), [snapshot, locationType]);
  const categories = useMemo(() => [...new Set((snapshot?.items ?? []).map((item) => item.category))]
    .sort((left, right) => left.localeCompare(right)), [snapshot]);
  const items = useMemo(() => (snapshot?.items ?? [])
    .filter((item) => !category || item.category === category)
    .sort((left, right) => left.name.localeCompare(right.name)), [snapshot, category]);
  const selectedLocation = snapshot?.locations.find((location) => location.id === locationId);
  const selectedItem = snapshot?.items.find((item) => item.id === itemId);
  const isWarehouseView = locationType === 'warehouse' || selectedLocation?.type === 'warehouse';
  const scopeLabel = selectedLocation?.name
    ?? (locationType === 'shop' ? 'all shops' : locationType === 'warehouse' ? 'all warehouses' : 'all locations');
  const productLabel = selectedItem?.name ?? (category || 'all items');

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void api.profitability(accessToken, {
      days,
      ...(locationType ? { locationType } : {}),
      ...(locationId ? { locationId } : {}),
      ...(category ? { category } : {}),
      ...(itemId ? { itemId } : {}),
    }).then((next) => {
      if (!cancelled) { setReport(next); setError(null); }
    }).catch((caught) => {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else if (!cancelled) setError(safeErrorMessage(caught, 'Could not load profitability. Try again.'));
    });
    return () => { cancelled = true; };
  }, [accessToken, category, days, itemId, locationId, locationType, signOut]);

  const maxTrend = useMemo(() => Math.max(...(report?.trend.flatMap((point) => [Math.abs(point.netSalesCents), Math.abs(point.grossProfitCents)]) ?? [1]), 1), [report]);
  const summary = report?.summary;

  return <>
    <PageHeader title="Profitability" subtitle="Compare sales profit and recorded inventory losses across the business." />
    <section className="panel profit-filter-panel" aria-label="Profitability filters">
      <div className="profit-filter-heading"><span><SlidersHorizontal size={16} />Report filters</span><small>Showing {scopeLabel} · {productLabel}</small></div>
      <div className="profit-filter-grid">
        <label><span>Period</span><SelectControl aria-label="Profit period" value={String(days)} onValueChange={(value) => setDays(Number(value) as ProfitPeriod)} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></label>
        <label><span>Location type</span><SelectControl aria-label="Location type" value={locationType} onValueChange={(value) => { setLocationType(value as LocationScope); setLocationId(''); }} options={[{ value: '', label: <><Building2 size={14} />All locations</> }, { value: 'shop', label: <><Store size={14} />Shops</> }, { value: 'warehouse', label: <><WarehouseIcon size={14} />Warehouses</> }]} /></label>
        <label><span>Place</span><SelectControl aria-label="Place" value={locationId} onValueChange={setLocationId} options={[{ value: '', label: locationType === 'shop' ? 'All shops' : locationType === 'warehouse' ? 'All warehouses' : 'All places' }, ...locations.map((location) => ({ value: location.id, label: location.name }))]} /></label>
        <label><span>Category</span><SelectControl aria-label="Category" value={category} onValueChange={(value) => { setCategory(value); setItemId(''); }} options={[{ value: '', label: 'All categories' }, ...categories.map((value) => ({ value, label: value }))]} /></label>
        <label><span>Item</span><SelectControl aria-label="Item" value={itemId} onValueChange={setItemId} options={[{ value: '', label: 'All items' }, ...items.map((item) => ({ value: item.id, label: item.name }))]} /></label>
      </div>
    </section>
    {error && <div className="form-error" role="alert">{error}</div>}
    {isWarehouseView && <div className="profit-warehouse-note"><WarehouseIcon size={19} /><div><b>Warehouses do not record sales in StockLedger</b><span>This view shows warehouse inventory losses. Gross profit stays at zero because sales are recorded from shops.</span></div></div>}
    {summary && <>
      {summary.costCoveragePercent < 100 && <div className="profit-coverage-note"><ReceiptText size={18} /><div><b>{summary.costCoveragePercent}% cost coverage</b><span>Gross profit excludes legacy sales that have no cost snapshot. Net sales still includes them.</span></div></div>}
      <section className="kpi-grid profit-kpis">
        <Kpi icon={CircleDollarSign} label="Net sales" value={money(summary.netSalesCents)} note={`${summary.unitsSold} sold · ${summary.unitsReturned} returned`} />
        <Kpi icon={ReceiptText} label="Cost of goods sold" value={money(summary.cogsCents)} note={`${money(summary.costedRevenueCents)} of costed sales`} />
        <Kpi icon={TrendingUp} label="Gross profit" value={money(summary.grossProfitCents)} note={isWarehouseView ? 'Sales are recorded at shops' : 'From sales with recorded cost'} tone="success" />
        <Kpi icon={Percent} label="Gross margin" value={summary.marginPercent === null ? '—' : `${summary.marginPercent.toFixed(1)}%`} note="Gross profit divided by costed sales" />
      </section>
      <section className="profit-layout">
        <Panel title="Sales and gross profit" subtitle={`${scopeLabel} over the last ${days} days`} className="profit-trend-panel">
          {report?.trend.length ? <div className="profit-chart"><div className="profit-chart-legend"><span><i className="sales" />Net sales</span><span><i className="profit" />Gross profit</span></div><div className="profit-chart-bars">{report.trend.map((point) => {
            const salesScale = Math.max(Math.abs(point.netSalesCents) / maxTrend, .03);
            const profitScale = Math.max(Math.abs(point.grossProfitCents) / maxTrend, .03);
            const description = `${calendarDate(point.date)}. ${money(point.netSalesCents)} net sales. ${money(point.grossProfitCents)} gross profit.`;
            return <div aria-label={description} className="profit-chart-day" key={point.date} role="img" tabIndex={0}>
              <span className="profit-chart-tooltip" role="tooltip"><b>{calendarDate(point.date)}</b><small><i className="sales" />Sales {money(point.netSalesCents)}</small><small><i className="profit" />Profit {money(point.grossProfitCents)}</small></span>
              <div><i className="sales" style={{ '--bar-scale': salesScale } as CSSProperties} /><i className="profit" style={{ '--bar-scale': profitScale } as CSSProperties} /></div><small>{point.date.slice(5)}</small>
            </div>;
          })}</div></div> : <EmptyState text={isWarehouseView ? 'Sales are recorded at shops, so this warehouse has no profit trend.' : 'No sales match these filters.'} />}
        </Panel>
        <Panel title="Inventory losses" subtitle="Damage and negative count adjustments at recorded cost"><div className="profit-loss"><span><PackageX size={22} /></span><strong>{money(summary.inventoryLossCents)}</strong><small>Tracked separately from gross profit</small></div></Panel>
      </section>
      <Panel title="Profit by item and place" className="spaced">
        {report?.lines.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th className="num">Sold</th><th className="num">Returned</th><th className="num">Net sales</th><th className="num">COGS</th><th className="num">Gross profit</th><th className="num">Margin</th></tr></thead><tbody>{report.lines.map((line) => <tr key={`${line.locationId}:${line.itemId}`}><td><b>{line.itemName}</b>{line.uncostedSaleUnits > 0 && <small>{line.uncostedSaleUnits} units without cost</small>}</td><td>{line.locationName}</td><td className="num">{line.unitsSold}</td><td className="num">{line.unitsReturned}</td><td className="num">{money(line.netSalesCents)}</td><td className="num">{money(line.cogsCents)}</td><td className={`num ${line.grossProfitCents < 0 ? 'negative' : 'positive'}`}>{money(line.grossProfitCents)}</td><td className="num">{line.marginPercent === null ? '—' : `${line.marginPercent.toFixed(1)}%`}</td></tr>)}</tbody></table></div> : <EmptyState text={isWarehouseView ? 'Warehouses hold and transfer stock. They do not have direct sales profit.' : 'No sales match these filters.'} />}
      </Panel>
    </>}
  </>;
}
