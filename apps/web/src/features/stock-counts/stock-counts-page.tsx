import { ProductPicker } from '../../components/ui/product-picker';
import { DatePicker } from '../../components/ui/date-picker';
import { companyDay } from '../../lib/date-range';
import { ClipboardCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
  const { money, calendarDate, settings, terms } = useCompanySettings();
  const countAction = useAsyncActionState();
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [counts, setCounts] = useState<StockCount[] | null>(null);
  const [form, setForm] = useState({ itemId: '', locationId: '', countedQuantity: '', countedAt: companyDay(settings?.timeZone), note: '' });
  const items = snapshot?.items.filter((item) => item.isActive) ?? [];
  const places = snapshot?.locations ?? [];
  const previewKey = `${form.itemId}:${form.locationId}:${form.countedAt}`;
  const [preview, setPreview] = useState<{ key: string; expected: number | null; error: string | null } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const expected = preview?.key === previewKey ? preview.expected : null;
  const previewError = preview?.key === previewKey ? preview.error : null;
  useEffect(() => {
    if (!accessToken || !form.itemId || !form.locationId || !form.countedAt) return;
    let cancelled = false;
    void api.stockCountPreview(accessToken, { itemId: form.itemId, locationId: form.locationId, countedAt: form.countedAt })
      .then(result => { if (!cancelled) setPreview({ key: previewKey, expected: result.expectedQuantity, error: null }); })
      .catch(() => { if (!cancelled) setPreview({ key: previewKey, expected: null, error: 'The ledger quantity for this date could not load. Retry before reviewing the variance.' }); });
    return () => { cancelled = true; };
  }, [accessToken, form.itemId, form.locationId, form.countedAt, previewKey, previewVersion, snapshot]);
  const variance = expected === null || form.countedQuantity === '' ? null : Number(form.countedQuantity) - expected;

  const load = useCallback(async () => {
    if (!accessToken) return;
    try { setCounts(await api.stockCounts(accessToken)); setHistoryError(null); }
    catch { setHistoryError('Count history could not load. Your count entries are kept.'); }
  }, [accessToken]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || expected === null) return;
    try { await countAction.run(async () => {
      await mutate(() => api.addStockCount(accessToken, {
      itemId: form.itemId,
      locationId: form.locationId,
      countedQuantity: Number(form.countedQuantity),
      countedAt: form.countedAt,
      expectedQuantity: expected,
      note: form.note,
      }), variance === 0 ? 'The count matched the ledger.' : `The ledger was adjusted by ${variance && variance > 0 ? '+' : ''}${variance ?? 0}.`);
      await load();
    }); } catch (caught) {
      // Keep entries and fetch a fresh dated expectation before the next review.
      setPreview(null); setPreviewVersion(value => value + 1);
      throw caught;
    }
    setForm((current) => ({ ...current, itemId: '', countedQuantity: '', note: '' }));
  };

  return <PageState>
    <PageHeader title="Stock counts" />
    <Panel title="Record a physical count" subtitle="A variance creates a traceable adjustment. Matching counts are recorded without changing stock.">
      {previewError && <div role="alert">{previewError} <button className="button secondary" onClick={() => setPreviewVersion(value => value + 1)}>Retry ledger quantity</button></div>}
      <form className="form-grid stock-count-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>Place</span><SelectControl aria-label="Place" required value={form.locationId} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select place' }, ...places.map((place) => ({ value: place.id, label: place.name }))]} /></label>
        <label><span>{terms.Item}</span><ProductPicker items={items} locationId={form.locationId} required value={form.itemId} onValueChange={(itemId) => setForm({ ...form, itemId })} /></label>
        <label><span>Ledger quantity</span><InputControl readOnly value={expected === null ? form.itemId && form.locationId ? 'Loading quantity for count date' : `Select an ${terms.item} and place` : String(expected)} /></label>
        <label><span>Counted quantity</span><InputControl type="number" min="0" required value={form.countedQuantity} onValueChange={(countedQuantity) => setForm({ ...form, countedQuantity })} /></label>
        <label><span>Count date</span><DatePicker label="Count date" required value={form.countedAt} onValueChange={(countedAt) => setForm({ ...form, countedAt })} /></label>
        <label><span>Reason or note</span><InputControl maxLength={500} required={Boolean(settings?.requireAdjustmentReason && variance !== null && variance !== 0)} value={form.note} onValueChange={(note) => setForm({ ...form, note })} /></label>
        <div className={`stock-count-variance ${variance === null || variance === 0 ? '' : variance > 0 ? 'positive' : 'negative'}`}><span>Variance</span><strong>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}`}</strong></div>
        <AsyncActionButton disabled={busy || !items.length || expected === null} idleLabel="Save count" pendingLabel="Saving" state={countAction.state} successLabel="Count saved" />
      </form>
    </Panel>
    <Panel title={`Count history (${counts?.length ?? 0})`} className="spaced">
      {historyError && <div role="alert">{historyError} <button type="button" className="button secondary" onClick={() => void load()}>Retry count history</button></div>}
      {counts?.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>{terms.Item}</th><th>Place</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th><th className="num">Value impact</th></tr></thead><tbody>{counts.map((count) => <tr key={count.id}><td>{calendarDate(count.countedAt)}</td><td><b>{count.item?.name ?? `Deleted ${terms.item}`}</b><small>{count.note}</small></td><td>{count.location?.name ?? 'Unknown'}</td><td className="num">{count.expectedQuantity}</td><td className="num">{count.countedQuantity}</td><td className={`num ${count.varianceQuantity > 0 ? 'positive' : count.varianceQuantity < 0 ? 'negative' : ''}`}>{count.varianceQuantity > 0 ? '+' : ''}{count.varianceQuantity}</td><td className="num">{money(count.valueImpactCents ?? count.varianceQuantity * count.unitCostCents)}</td></tr>)}</tbody></table></div> : counts ? <EmptyState icon={<ClipboardCheck size={21} />} text="No stock counts yet." /> : !historyError && <div className="empty"><p>Loading count history</p></div>}
    </Panel>
  </PageState>;
}
