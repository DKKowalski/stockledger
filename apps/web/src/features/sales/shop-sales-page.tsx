import { companyDay } from '../../lib/date-range';
import { InventoryDateRangeFilter } from '../../components/inventory-date-range-filter';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Checkout, hasPendingSale } from './checkout';
import { api, ApiError } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InfoTooltip } from '../../components/ui/info-tooltip';
import { InputControl } from '../../components/ui/input-control';
import { AsyncActionButton } from '../../components/ui/async-action-button';
import type { User } from '../../types';
import { useAsyncActionState } from '../../components/ui/use-async-action-state';

const retailStorageKey = (user: User) => `stockledger:retail-sale:${user.companyId}:${user.id}:${user.locationId}`;
function hasRetailAttempt(user: User) {
  try { return localStorage.getItem(retailStorageKey(user)) !== null; } catch { return true; }
}

export function ShopSalesPage() {
  const { accessToken, user } = useAuth();
  // null while the box and quantity deals switch is still loading.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [retailRecovery, setRetailRecovery] = useState(() => user ? hasRetailAttempt(user) : false);
  const [recovering, setRecovering] = useState(() => user ? hasPendingSale(user) : false);
  useEffect(() => {
    const recover = () => { if (user) { setRetailRecovery(hasRetailAttempt(user)); if (hasPendingSale(user)) setRecovering(true); } };
    window.addEventListener('storage', recover);
    return () => window.removeEventListener('storage', recover);
  }, [user]);
  useEffect(() => {
    let active = true;
    if (accessToken) void api.saleCompletionStatus(accessToken).then((result) => { if (active) setAvailable(result.available); }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [accessToken]);
  if (user && (retailRecovery || hasRetailAttempt(user))) return <RetailSalePage onResolved={() => setRetailRecovery(false)} />;
  // A sale waiting for confirmation always reopens checkout so it can be resolved.
  if (user && (available || recovering || hasPendingSale(user))) return <Checkout enabled={available === true} />;
  if (available === null) return <div className="empty page-state"><p>Loading checkout</p></div>;
  return <RetailSalePage />;
}

type RetailAttempt = {
  body: Parameters<typeof api.addMovement>[1];
  itemName: string;
  unit: string;
};

function readRetailAttempt(key: string): RetailAttempt | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as RetailAttempt;
  if (!value?.body?.idempotencyKey || !value.body.itemId || value.body.type !== 'sale' || !Number.isInteger(value.body.quantity)) {
    throw new Error('The pending sale could not be read. Keep this browser data and contact support before recording another sale.');
  }
  return value;
}

function RetailSalePage({ onResolved }: { onResolved?: () => void }) {
  const { accessToken, user } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { money, calendarDate, terms, settings } = useCompanySettings();
  const saleAction = useAsyncActionState();
  const storageKey = retailStorageKey(user!);
  const generationKey = `${storageKey}:generation`;
  const [recovery, setRecovery] = useState(() => {
    try { return { pending: readRetailAttempt(storageKey), error: null as string | null }; }
    catch { return { pending: null, error: 'Pending sale recovery is unavailable. Keep this browser data and contact support before recording another sale.' }; }
  });
  const [form, setForm] = useState(() => ({ itemId: recovery.pending?.body.itemId ?? '', quantity: recovery.pending ? String(recovery.pending.body.quantity) : '' }));
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  const [initialGeneration] = useState(() => { try { return localStorage.getItem(generationKey); } catch { return null; } });
  const generation = useRef(initialGeneration);
  useEffect(() => {
    const load = () => {
      try {
        const pending = readRetailAttempt(storageKey);
        setRecovery({ pending, error: null });
        if (pending) setForm({ itemId: pending.body.itemId, quantity: String(pending.body.quantity) });
      } catch { setRecovery(current => ({ ...current, error: 'Pending sale recovery is unavailable. Keep this browser data and contact support.' })); }
    };
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, [storageKey]);
  const shop = snapshot?.locations.find((place) => place.id === user?.locationId) ?? snapshot?.locations[0];
  const stocked = snapshot?.positions.filter((position) => position.closing > 0) ?? [];
  const selected = stocked.find((position) => position.item.id === form.itemId);
  const unitPriceCents = recovery.pending?.body.expectedUnitPriceCents ?? selected?.item.sellingPriceCents;
  const totalCents = unitPriceCents == null || !form.quantity ? null : unitPriceCents * Number(form.quantity);
  const sales = snapshot?.periodMovements.filter((movement) => movement.type === 'sale') ?? [];

  const send = async (attempt: RetailAttempt) => {
    if (!accessToken) return;
    try {
      const result = await api.addMovement(accessToken, attempt.body);
      // Resolve the durable intent before reading inventory. A failed read cannot resubmit it.
      localStorage.removeItem(storageKey);
      setRecovery({ pending: null, error: null });
      setForm({ itemId: '', quantity: '' });
      setMessage('Sale recorded once. You can record the next sale.');
      await mutate(async () => result, `Sold ${attempt.body.quantity} ${attempt.unit} of ${attempt.itemName}.`);
      onResolved?.();
    } catch (caught) {
      if (caught instanceof ApiError && [400, 403, 404, 409, 422].includes(caught.status)) {
        localStorage.removeItem(storageKey);
        setRecovery({ pending: null, error: caught.message });
      } else {
        setRecovery({ pending: attempt, error: 'We could not confirm whether this sale was recorded. Your entries are kept. Retry the same sale to confirm it safely; it will be recorded only once.' });
      }
      throw caught;
    }
  };
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (running.current || !accessToken || !user?.locationId || recovery.error && !recovery.pending) return;
    running.current = true;
    setMessage(null);
    try {
      await saleAction.run(async () => {
        if (!navigator.locks) throw new Error('Use an up-to-date browser to record sales safely.');
        // Keep the lock through acknowledgement. Otherwise a late response from
        // another tab could erase a newer pending attempt in the shared slot.
        await navigator.locks.request(storageKey, async () => {
          const existing = readRetailAttempt(storageKey);
          if (existing) { setRecovery({ pending: existing, error: null }); await send(existing); return; }
          if (generation.current !== localStorage.getItem(generationKey)) {
            throw new Error('Another tab recorded a sale. Reload and review your entries before starting the next sale.');
          }
          if (!selected || unitPriceCents == null) return null;
          const next: RetailAttempt = { body: {
            itemId: selected.item.id, locationId: user.locationId!, type: 'sale', quantity: Number(form.quantity),
            expectedUnitPriceCents: unitPriceCents, movementDate: companyDay(settings?.timeZone), idempotencyKey: crypto.randomUUID(),
          }, itemName: selected.item.name, unit: selected.item.unit };
          // Save before sending. Reloads and other tabs must reuse this exact intent.
          const nextGeneration = crypto.randomUUID();
          localStorage.setItem(generationKey, nextGeneration);
          localStorage.setItem(storageKey, JSON.stringify(next));
          generation.current = nextGeneration;
          setRecovery({ pending: next, error: null });
          await send(next);
        });
      });
    } catch (caught) {
      setRecovery(current => ({ ...current, error: current.pending ? current.error : caught instanceof Error ? caught.message : 'Could not record this sale. Review your entries and try again.' }));
    } finally { running.current = false; }
  };

  return <PageState>
    <PageHeader title="Sell" subtitle={shop ? `A sale reduces stock at ${shop.name} only.` : `A sale reduces stock at your ${terms.shop} only.`} />
    <Panel title="Record a sale">
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {message && <p role="status">{message}</p>}
      {recovery.pending && <p role="status">The last sale needs confirmation: {recovery.pending.body.quantity} {recovery.pending.unit} of {recovery.pending.itemName}. Retry this request before starting another sale.</p>}
      {stocked.length || recovery.pending ? <form className="form-grid sell-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <fieldset disabled={!!recovery.pending || !!recovery.error || busy}>
        <label><span>{terms.Item}</span><SelectControl aria-label={terms.Item} required value={form.itemId} onValueChange={(itemId) => setForm({ itemId, quantity: '' })} options={[{ value: '', label: `Select ${terms.item}` }, ...stocked.map((position) => ({ value: position.item.id, label: position.item.name }))]} /></label>
        <label><span className="label-row"><span>Quantity</span><InfoTooltip label="Stock on hand">{selected ? `${selected.closing} ${selected.item.unit} on hand` : `Choose a ${terms.item} to see what is on hand`}</InfoTooltip></span><InputControl aria-label="Quantity" type="number" min="1" max={selected?.closing} required value={form.quantity} onValueChange={(quantity) => setForm({ ...form, quantity })} /></label>
        <label><span>Unit price</span><InputControl readOnly value={unitPriceCents == null ? 'Not set' : money(unitPriceCents)} /></label>
        <label><span>Total</span><output className="sale-total" aria-live="polite">{totalCents == null ? '—' : money(totalCents)}</output></label>
        </fieldset>
        {recovery.pending ? <button className="button" type="button" disabled={busy || saleAction.state === 'pending'} onClick={() => void submit()}>Retry same sale</button> : <AsyncActionButton disabled={busy || !selected || unitPriceCents == null || !!recovery.error} idleLabel="Sell" pendingLabel="Recording" state={saleAction.state} successLabel="Sale recorded" />}
        {recovery.error && !recovery.pending && <button className="button secondary" type="button" onClick={() => setRecovery({ pending: null, error: null })}>Review entries</button>}
        {selected && unitPriceCents == null && <p className="price-hint" role="status">Ask an administrator to set a selling price for this {terms.item}.</p>}
      </form> : <EmptyState text={`Nothing to sell yet. Stock arrives when someone transfers it to this ${terms.shop}.`} />}
    </Panel>
    <Panel title={`Sales in selected period (${sales.length})`} className="spaced">
      <div className="sales-period-filter"><InventoryDateRangeFilter /></div>
      {sales.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>{terms.Item}</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td>{calendarDate(sale.movementDate)}</td><td><b>{sale.item?.name ?? `Deleted ${terms.item}`}</b><small>{sale.item?.sku}</small></td><td className="num negative">−{sale.quantity}</td><td className="num">{sale.unitPriceCents == null ? 'Not recorded' : money(sale.unitPriceCents)}</td><td className="num">{sale.saleTotalCents == null ? 'Not recorded' : money(sale.saleTotalCents)}</td></tr>)}</tbody></table></div> : <EmptyState text={`No sales recorded at this ${terms.shop} yet.`} />}
    </Panel>
  </PageState>;
}
