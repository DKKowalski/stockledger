import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { safeErrorMessage } from '../../lib/user-facing-error';
import { formatMoney } from '../../lib/presentation';
import type { CompletedSale, SaleQuote, User } from '../../types';

type Pending = { idempotencyKey: string; quoteToken: string };
const generationKey = (user: User) => `stockledger:sale-generation:${user.companyId}:${user.id}:${user.locationId}`;
const prefix = (user: User) => `stockledger:sale-request:${user.companyId}:${user.id}:${user.locationId}:`;
function stored(user: User): Pending | null {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix(user))) {
      const value: unknown = JSON.parse(localStorage.getItem(key)!);
      if (value && typeof value === 'object' && 'idempotencyKey' in value && 'quoteToken' in value && typeof value.idempotencyKey === 'string' && typeof value.quoteToken === 'string') return value as Pending;
      throw new Error('A pending sale record cannot be read. Keep this browser data and contact support before recording another sale.');
    }
  }
  return null;
}
// Any unreadable browser recovery record must block starting another request.
// eslint-disable-next-line react-refresh/only-export-components
export function hasPendingSale(user: User) {
  try { return Object.keys(localStorage).some((key) => key.startsWith(prefix(user))); } catch { return false; }
}

const pricingLabels = { retail: 'Single price', bulk: 'Quantity discount', box: 'Box price' } as const;

// The Sell screen when the owner has switched on box and quantity deals.
// Items without deals are charged their single price.
export function Checkout({ enabled }: { enabled: boolean }) {
  const { user, accessToken } = useAuth();
  const { snapshot, mutate, busy: inventoryBusy, error: inventoryError } = useInventoryStore();
  const { settings, loading: settingsLoading, terms } = useCompanySettings();
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const reviewGeneration = useRef('');
  useEffect(() => {
    const load = (event?: StorageEvent) => {
      if (event && event.key && user && event.key !== generationKey(user) && !event.key.startsWith(prefix(user))) return;
      try {
        if (user) {
          const next = stored(user); setPending(next);
          if (event || next) setQuote(null);
        }
      }
      catch (caught) { setError(safeErrorMessage(caught, 'Pending sale recovery is unavailable')); }
    };
    load(); window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, [user]);
  const shopName = snapshot?.locations.find((location) => location.id === user?.locationId)?.name ?? `your ${terms.shop}`;
  const positions = snapshot?.positions.filter((position) => position.closing > 0 && position.item.isActive) ?? [];
  const selected = positions.find((position) => position.item.id === itemId);
  const money = (cents: number, currency = quote?.currency ?? completed?.currency ?? settings?.currency ?? 'GHS') => formatMoney(cents, currency);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (caught) { setError(safeErrorMessage(caught, 'Could not confirm this sale. Check its status before continuing.')); }
    finally { running.current = false; setBusy(false); }
  };
  const review = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!user || !accessToken || !selected || !enabled || stored(user)) return;
      const generation = localStorage.getItem(generationKey(user)) ?? '';
      const preview = await api.quotePricingPreview(accessToken, [{ itemId, quantity: Number(quantity) }]);
      const line = preview.lines[0];
      if (!line || selected.item.sellingPriceCents == null) throw new Error('Ask an administrator to set a selling price for this item.');
      const movementDate = new Intl.DateTimeFormat('en-CA', { timeZone: settings?.timeZone ?? 'Africa/Accra', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      setCompleted(null);
      const nextQuote = await api.saleQuote(accessToken, { movementDate, lines: [{ itemId, quantity: Number(quantity), expectedVersion: line.configurationVersion ?? line.pricingVersion ?? 0, expectedRetailPriceCents: selected.item.sellingPriceCents }] });
      if (generation !== (localStorage.getItem(generationKey(user)) ?? '')) throw new Error('Another sale request changed this checkout. Review a new quote.');
      reviewGeneration.current = generation; setQuote(nextQuote);
    });
  };
  const finish = async (sale: CompletedSale, request: Pending) => {
    if (!user) return;
    // Resolve the durable request before refreshing; failed refresh must never resubmit this sale.
    localStorage.removeItem(`${prefix(user)}${request.idempotencyKey}`);
    setPending(stored(user)); setQuote(null); setItemId(''); setQuantity(''); setCompleted(sale);
    await mutate(async () => sale, 'Sale recorded.');
  };
  const send = async (request: Pending) => {
    if (!accessToken || !user) return;
    try { await finish(await api.completeSale(accessToken, request), request); }
    catch (caught) {
      if (caught instanceof ApiError && [400, 403, 404, 409, 422].includes(caught.status)) {
        localStorage.removeItem(`${prefix(user)}${request.idempotencyKey}`);
        setPending(stored(user)); setQuote(null);
      }
      throw caught;
    }
  };
  const complete = () => void run(async () => {
    if (!accessToken || !user || !quote || !enabled || stored(user)) return;
    if (!navigator.locks) throw new Error('This browser cannot safely coordinate checkout. Use an up-to-date browser.');
    // Persist the intent under an origin-wide lock before any network operation.
    // A second tab must adopt the pending request instead of minting another key.
    const request = await navigator.locks.request(prefix(user), () => {
      const existing = stored(user);
      if (existing) { setPending(existing); setQuote(null); return null; }
      if (reviewGeneration.current !== (localStorage.getItem(generationKey(user)) ?? '')) {
        setQuote(null); throw new Error('Another sale request changed this checkout. Review a new quote.');
      }
      const next = { idempotencyKey: crypto.randomUUID(), quoteToken: quote.quoteToken };
      // Retained after completion so a suspended tab cannot reuse an earlier review.
      localStorage.setItem(generationKey(user), crypto.randomUUID());
      localStorage.setItem(`${prefix(user)}${next.idempotencyKey}`, JSON.stringify(next));
      setPending(next);
      return next;
    });
    if (request) await send(request);
  });
  const check = () => void run(async () => {
    if (!pending || !accessToken) return;
    const result = await api.saleByKey(accessToken, pending.idempotencyKey);
    if (result.sale) await finish(result.sale, pending);
    else setMessage('No completed sale was found yet. Retry this request to confirm it safely.');
  });
  return <PageState>
    <PageHeader title="Sell" subtitle={`A sale reduces stock at ${shopName} only. Box and quantity deals apply automatically.`} />
    <Panel title={pending ? 'Confirm pending sale' : 'Record a sale'}><div className="checkout-body">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending ? <div>
        <p>The last request needs confirmation. Keep this request until its result is known.</p>
        <button className="button" disabled={busy} onClick={check}>Check sale status</button>
        <button className="button secondary" disabled={busy} onClick={() => void run(() => send(pending))}>Retry same sale</button>
      </div> : <form className="form-grid" onSubmit={review}>
        <fieldset disabled={busy || inventoryBusy || settingsLoading || !settings || !!inventoryError || !enabled}>
          <label><span>{terms.Item}</span><SelectControl aria-label={terms.Item} value={itemId} onValueChange={(value) => { setItemId(value); setQuote(null); }} options={[{ value: '', label: `Select ${terms.item}` }, ...positions.map((position) => ({ value: position.item.id, label: position.item.name }))]} /></label>
          <label><span>Quantity</span><InputControl aria-label="Quantity" type="number" min="1" max={selected?.closing} required value={quantity} onValueChange={(value) => { setQuantity(value); setQuote(null); }} /></label>
          <button className="button secondary" disabled={!selected} type="submit">Review sale</button>
        </fieldset>
      </form>}
      {!pending && quote && <div className="pricing-quote-result" role="status">
        <p>{quote.lines[0].quantity} {quote.lines[0].baseUnit} · Total <strong>{money(quote.totalCents)}</strong></p>
        {quote.automaticDiscountCents > 0 && <p className="checkout-saving">Includes {money(quote.automaticDiscountCents)} off the single price of {money(quote.grossSalesCents)}.</p>}
        <div className="table-wrap"><table><thead><tr><th>How it is charged</th><th className="num">Quantity</th><th className="num">Each</th><th className="num">Total</th></tr></thead><tbody>{quote.lines[0].components.map((part, index) => <tr key={index}><td>{part.category === 'box' && quote.lines[0].package ? `${quote.lines[0].package.label.charAt(0).toUpperCase()}${quote.lines[0].package.label.slice(1)} price (${quote.lines[0].package.size} per ${quote.lines[0].package.label})` : pricingLabels[part.category]}</td><td className="num">{part.quantity}</td><td className="num">{money(part.unitPriceCents)}</td><td className="num">{money(part.totalCents)}</td></tr>)}</tbody></table></div>
        <button className="button" disabled={busy || !enabled || !!inventoryError} onClick={complete}>Complete sale</button>
      </div>}
      {completed && <p role="status">Sale recorded · {money(completed.totalCents, completed.currency)}</p>}
    </div></Panel>
  </PageState>;
}
