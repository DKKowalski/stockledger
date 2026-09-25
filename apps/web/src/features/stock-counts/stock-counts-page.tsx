import { ClipboardCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { AsyncActionButton } from '../../components/ui/async-action-button';
import { useAsyncActionState } from '../../components/ui/use-async-action-state';
import type { StockCount } from '../../types';

export function StockCountsPage() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { money, calendarDate } = useCompanySettings();
  const countAction = useAsyncActionState();
  const [counts, setCounts] = useState<StockCount[] | null>(null);
  const [form, setForm] = useState({ itemId: '', locationId: '', countedQuantity: '', countedAt: new Date().toISOString().slice(0, 10), note: '' });
  const items = snapshot?.items.filter((item) => item.isActive) ?? [];
  const places = snapshot?.locations ?? [];
  const expected = useMemo(() => snapshot?.positions.find((position) => position.item.id === form.itemId && position.location.id === form.locationId)?.closing ?? null, [snapshot, form.itemId, form.locationId]);
  const variance = expected === null || form.countedQuantity === '' ? null : Number(form.countedQuantity) - expected;

  const load = useCallback(async () => {
    if (accessToken) setCounts(await api.stockCounts(accessToken));
  }, [accessToken]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await countAction.run(async () => {
      await mutate(() => api.addStockCount(accessToken, {
      itemId: form.itemId,
      locationId: form.locationId,
      countedQuantity: Number(form.countedQuantity),
      countedAt: form.countedAt,
      note: form.note,
      }), variance === 0 ? 'The count matched the ledger.' : `The ledger was adjusted by ${variance && variance > 0 ? '+' : ''}${variance ?? 0}.`);
      await load();
    });
    setForm((current) => ({ ...current, itemId: '', countedQuantity: '', note: '' }));
  };

  return <PageState>
    <PageHeader title="Stock counts" subtitle="Compare what is on the shelf with the ledger and record the variance." />
    <Panel title="Record a physical count" subtitle="A variance creates a traceable adjustment. Matching counts are recorded without changing stock.">
      <form className="form-grid stock-count-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>Place</span><SelectControl aria-label="Place" required value={form.locationId} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select place' }, ...places.map((place) => ({ value: place.id, label: place.name }))]} /></label>
        <label><span>Item</span><SelectControl aria-label="Item" required value={form.itemId} onValueChange={(itemId) => setForm({ ...form, itemId })} options={[{ value: '', label: 'Select item' }, ...items.map((item) => ({ value: item.id, label: item.name }))]} /></label>
        <label><span>Ledger quantity</span><InputControl readOnly value={expected === null ? 'Select an item and place' : String(expected)} /></label>
        <label><span>Counted quantity</span><InputControl type="number" min="0" required value={form.countedQuantity} onValueChange={(countedQuantity) => setForm({ ...form, countedQuantity })} /></label>
        <label><span>Count date</span><InputControl type="date" required value={form.countedAt} onValueChange={(countedAt) => setForm({ ...form, countedAt })} /></label>
        <label><span>Reason or note</span><InputControl maxLength={500} value={form.note} onValueChange={(note) => setForm({ ...form, note })} /></label>
        <div className={`stock-count-variance ${variance === null || variance === 0 ? '' : variance > 0 ? 'positive' : 'negative'}`}><span>Variance</span><strong>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}`}</strong></div>
        <AsyncActionButton disabled={busy || !items.length} idleLabel="Save count" pendingLabel="Saving" state={countAction.state} successLabel="Count saved" />
      </form>
    </Panel>
    <Panel title={`Count history (${counts?.length ?? 0})`} className="spaced">
      {counts?.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Place</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th><th className="num">Value impact</th></tr></thead><tbody>{counts.map((count) => <tr key={count.id}><td>{calendarDate(count.countedAt)}</td><td><b>{count.item?.name ?? 'Deleted item'}</b><small>{count.note}</small></td><td>{count.location?.name ?? 'Unknown'}</td><td className="num">{count.expectedQuantity}</td><td className="num">{count.countedQuantity}</td><td className={`num ${count.varianceQuantity > 0 ? 'positive' : count.varianceQuantity < 0 ? 'negative' : ''}`}>{count.varianceQuantity > 0 ? '+' : ''}{count.varianceQuantity}</td><td className="num">{money(count.varianceQuantity * count.unitCostCents)}</td></tr>)}</tbody></table></div> : counts ? <EmptyState icon={<ClipboardCheck size={21} />} text="No stock counts yet." /> : <div className="empty"><p>Loading count history</p></div>}
    </Panel>
  </PageState>;
}
