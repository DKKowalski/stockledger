import { NavLink, useSearchParams } from 'react-router-dom';
import { ProductPicker } from '../../components/ui/product-picker';
import { companyDay } from '../../lib/date-range';
import { InventoryDateRangeFilter } from '../../components/inventory-date-range-filter';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Checkout, hasPendingSale } from './checkout';
import { api, ApiError } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState } from '../../components/inventory-ui';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button, buttonVariants } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { AsyncActionButton } from '../../components/ui/async-action-button';
import type { User } from '../../types';
import { useAsyncActionState } from '../../components/ui/use-async-action-state';

const retailStorageKey = (user: User) => `stockledger:retail-sale:${user.companyId}:${user.id}:${user.locationId}`;
function hasRetailAttempt(user: User) {
  try { return localStorage.getItem(retailStorageKey(user)) !== null; } catch { return true; }
}

export function ShopSalesPage() {
  const { accessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [basketAvailable, setBasketAvailable] = useState(false);
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
    if (accessToken) void api.saleCompletionStatus(accessToken).then((result) => { if (active) { setAvailable(result.available); setBasketAvailable(result.basketAvailable === true); } }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [accessToken]);
  if (user && (retailRecovery || hasRetailAttempt(user))) return <RetailSalePage onResolved={() => setRetailRecovery(false)} />;
  // A sale waiting for confirmation always reopens checkout so it can be resolved.
  if (user && (available || (basketAvailable && searchParams.get('basket') === '1') || recovering || hasPendingSale(user))) return <Checkout enabled={available === true || basketAvailable} />;
  if (available === null) return <div className="empty page-state"><p>Loading checkout</p></div>;
  return <RetailSalePage basketAvailable={basketAvailable} />;
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

function RetailSalePage({ onResolved, basketAvailable = false }: { onResolved?: () => void; basketAvailable?: boolean }) {
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
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(() => ({ itemId: recovery.pending?.body.itemId ?? searchParams.get('item') ?? '', quantity: recovery.pending ? String(recovery.pending.body.quantity) : '' }));
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
  const stocked = snapshot?.positions.filter((position) => position.closing > 0 && position.location.id === user?.locationId) ?? [];
  const selected = stocked.find((position) => position.item.id === form.itemId);
  const unitPriceCents = recovery.pending?.body.expectedUnitPriceCents ?? selected?.item.sellingPriceCents;
  const totalCents = unitPriceCents == null || !form.quantity ? null : unitPriceCents * Number(form.quantity);
  const sales = snapshot?.periodMovements.filter((movement) => movement.type === 'sale' && movement.locationId === user?.locationId) ?? [];

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
    <PageHeader title="Sell" actions={basketAvailable ? <NavLink className={buttonVariants({ variant: 'outline', className: 'h-11 px-4' })} to="/sell?basket=1">Basket sale</NavLink> : undefined} subtitle={shop ? `A sale reduces stock at ${shop.name} only.` : `A sale reduces stock at your ${terms.shop} only.`} />
    <Card>
      <CardHeader><CardTitle><h2 className="text-base font-semibold">Record a sale</h2></CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {recovery.error && <Alert variant="destructive"><AlertDescription>{recovery.error}</AlertDescription></Alert>}
        {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
        {recovery.pending && <Alert role="status"><AlertDescription>The last sale needs confirmation: {recovery.pending.body.quantity} {recovery.pending.unit} of {recovery.pending.itemName}. Retry this request before starting another sale.</AlertDescription></Alert>}
        {stocked.length || recovery.pending ? <form className="grid gap-4" onSubmit={(event) => void submit(event).catch(() => {})}>
          <fieldset className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] items-end gap-4 border-0 p-0" disabled={!!recovery.pending || !!recovery.error || busy}>
            <Label className="grid gap-2"><span>{terms.Item}</span><ProductPicker items={snapshot?.items.filter(item => item.isActive) ?? []} locationId={user?.locationId} selling required value={form.itemId} onValueChange={(itemId) => setForm({ itemId, quantity: '' })} /></Label>
            <div className="grid gap-2"><Label htmlFor="sale-quantity">Quantity{selected && <small className="selected-availability block text-[13px] font-medium text-muted-foreground">{selected.closing} {selected.item.unit} available at {shop?.name ?? 'your shop'}</small>}</Label><Input id="sale-quantity" className="h-11" aria-label="Quantity" type="number" min="1" max={selected?.closing} required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor="sale-unit-price">Unit price</Label><Input id="sale-unit-price" className="h-11" readOnly value={unitPriceCents == null ? 'Not set' : money(unitPriceCents)} /></div>
            <div className="grid gap-2"><Label htmlFor="sale-total">Total</Label><output id="sale-total" className="flex min-h-11 items-center text-lg font-medium tabular-nums" aria-live="polite">{totalCents == null ? '—' : money(totalCents)}</output></div>
          </fieldset>
          <div className="flex flex-wrap gap-2.5">
            {recovery.pending ? <Button type="button" className="h-11 px-4" disabled={busy || saleAction.state === 'pending'} onClick={() => void submit()}>Retry same sale</Button> : <AsyncActionButton disabled={busy || !selected || unitPriceCents == null || !!recovery.error} idleLabel="Sell" pendingLabel="Recording" state={saleAction.state} successLabel="Sale recorded" />}
            {recovery.error && !recovery.pending && <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setRecovery({ pending: null, error: null })}>Review entries</Button>}
          </div>
          {selected && unitPriceCents == null && <p className="text-[13px]" role="status">Ask an administrator to set a selling price for this {terms.item}.</p>}
        </form> : <EmptyState text={`Nothing to sell yet. Stock arrives when someone transfers it to this ${terms.shop}.`} />}
      </CardContent>
    </Card>
    <Card className="mt-4">
      <CardHeader><CardTitle><h2 className="text-base font-semibold">{`Sales in selected period (${sales.length})`}</h2></CardTitle></CardHeader>
      <CardContent className="grid gap-4 px-0">
        <div className="px-4"><InventoryDateRangeFilter /></div>
        {sales.length ? <Table containerProps={{ tabIndex: 0, role: 'region', 'aria-label': 'Scrollable table' }}>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>{terms.Item}</TableHead><TableHead className="num">Qty</TableHead><TableHead className="num">Unit price</TableHead><TableHead className="num">Total</TableHead></TableRow></TableHeader>
          <TableBody>{sales.map((sale) => <TableRow key={sale.id}><TableCell>{calendarDate(sale.movementDate)}</TableCell><TableCell><b>{sale.item?.name ?? `Deleted ${terms.item}`}</b><small>{sale.item?.sku}</small></TableCell><TableCell className="num negative">−{sale.quantity}</TableCell><TableCell className="num">{sale.unitPriceCents == null ? 'Not recorded' : money(sale.unitPriceCents)}</TableCell><TableCell className="num">{sale.saleTotalCents == null ? 'Not recorded' : money(sale.saleTotalCents)}</TableCell></TableRow>)}</TableBody>
        </Table> : <EmptyState text={`No sales recorded at this ${terms.shop} yet.`} />}
      </CardContent>
    </Card>
  </PageState>;
}
