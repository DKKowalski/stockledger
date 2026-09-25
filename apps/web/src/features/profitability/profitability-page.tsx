import { CircleDollarSign, PackageX, Percent, ReceiptText, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, Kpi, LocationFilter, PageHeader, Panel, SelectControl } from '../../components/inventory-ui';
import type { Profitability } from '../../types';

export function ProfitabilityPage() {
  const { accessToken, signOut } = useAuth();
  const { days, setDays, locationId } = useInventoryStore();
  const { money } = useCompanySettings();
  const [report, setReport] = useState<Profitability | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void api.profitability(accessToken, days, locationId).then((next) => {
      if (!cancelled) { setReport(next); setError(null); }
    }).catch((caught) => {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load profitability');
    });
    return () => { cancelled = true; };
  }, [accessToken, days, locationId, signOut]);

  const maxTrend = useMemo(() => Math.max(...(report?.trend.flatMap((point) => [Math.abs(point.netSalesCents), Math.abs(point.grossProfitCents)]) ?? [1]), 1), [report]);
  const summary = report?.summary;
  return <>
    <PageHeader title="Profitability" subtitle="Gross profit from sales with a recorded historical cost." actions={<><LocationFilter /><SelectControl aria-label="Profit period" value={String(days)} onValueChange={(value) => setDays(Number(value))} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></>} />
    {error && <div className="form-error" role="alert">{error}</div>}
    {summary && <>
      {summary.costCoveragePercent < 100 && <div className="profit-coverage-note"><ReceiptText size={18} /><div><b>{summary.costCoveragePercent}% cost coverage</b><span>Gross profit excludes legacy sales that have no cost snapshot. Net sales still includes them.</span></div></div>}
      <section className="kpi-grid profit-kpis">
        <Kpi icon={CircleDollarSign} label="Net sales" value={money(summary.netSalesCents)} note={`${summary.unitsSold} sold · ${summary.unitsReturned} returned`} />
        <Kpi icon={ReceiptText} label="Cost of goods sold" value={money(summary.cogsCents)} note={`${money(summary.costedRevenueCents)} of costed sales`} />
        <Kpi icon={TrendingUp} label="Gross profit" value={money(summary.grossProfitCents)} note="From sales with recorded cost" tone="success" />
        <Kpi icon={Percent} label="Gross margin" value={summary.marginPercent === null ? '—' : `${summary.marginPercent.toFixed(1)}%`} note="Gross profit divided by costed sales" />
      </section>
      <section className="profit-layout">
        <Panel title="Sales and gross profit" subtitle={`Daily results over the last ${days} days`} className="profit-trend-panel">
          {report?.trend.length ? <div className="profit-chart"><div className="profit-chart-legend"><span><i className="sales" />Net sales</span><span><i className="profit" />Gross profit</span></div><div className="profit-chart-bars">{report.trend.map((point) => <div className="profit-chart-day" key={point.date} title={`${point.date}: ${money(point.netSalesCents)} sales, ${money(point.grossProfitCents)} profit`}><div><i className="sales" style={{ height: `${Math.max(Math.abs(point.netSalesCents) / maxTrend * 100, 3)}%` }} /><i className="profit" style={{ height: `${Math.max(Math.abs(point.grossProfitCents) / maxTrend * 100, 3)}%` }} /></div><small>{point.date.slice(5)}</small></div>)}</div></div> : <EmptyState text="Record sales to see the profit trend." />}
        </Panel>
        <Panel title="Inventory losses" subtitle="Damage and negative count adjustments at recorded cost"><div className="profit-loss"><span><PackageX size={22} /></span><strong>{money(summary.inventoryLossCents)}</strong><small>Tracked separately from gross profit</small></div></Panel>
      </section>
      <Panel title="Profit by item and place" className="spaced">
        {report?.lines.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th className="num">Sold</th><th className="num">Returned</th><th className="num">Net sales</th><th className="num">COGS</th><th className="num">Gross profit</th><th className="num">Margin</th></tr></thead><tbody>{report.lines.map((line) => <tr key={`${line.locationId}:${line.itemId}`}><td><b>{line.itemName}</b>{line.uncostedSaleUnits > 0 && <small>{line.uncostedSaleUnits} units without cost</small>}</td><td>{line.locationName}</td><td className="num">{line.unitsSold}</td><td className="num">{line.unitsReturned}</td><td className="num">{money(line.netSalesCents)}</td><td className="num">{money(line.cogsCents)}</td><td className={`num ${line.grossProfitCents < 0 ? 'negative' : 'positive'}`}>{money(line.grossProfitCents)}</td><td className="num">{line.marginPercent === null ? '—' : `${line.marginPercent.toFixed(1)}%`}</td></tr>)}</tbody></table></div> : <EmptyState text="No sales in this period." />}
      </Panel>
    </>}
  </>;
}
