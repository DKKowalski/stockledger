import { NavLink, useSearchParams } from 'react-router-dom';
import { ProductPicker } from '../../components/ui/product-picker';
import { companyDay } from '../../lib/date-range';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { safeErrorMessage } from '../../lib/user-facing-error';
import { parseMoneyCents, formatMoney } from '../../lib/presentation';
import type { CompletedSale, SaleQuote, SaleTender, User } from '../../types';

type Pending = { idempotencyKey: string; quoteToken: string; tender?: SaleTender };
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

const pricingLabels = { retail: 'Normal price', bulk: 'Quantity discount', box: 'Box price' } as const;

// The Sell screen when the owner has switched on box and quantity deals.
// Items without deals are charged their normal price.
export function Checkout({ enabled }: { enabled: boolean }) {
  const { user, accessToken } = useAuth();
  const { snapshot, mutate, refresh, busy: inventoryBusy, error: inventoryError } = useInventoryStore();
  const { settings, loading: settingsLoading, terms } = useCompanySettings();
  const [searchParams] = useSearchParams();
  const [itemId, setItemId] = useState(searchParams.get('item') ?? '');
  const [quantity, setQuantity] = useState('');
  const [basket, setBasket] = useState<Array<{ itemId: string; quantity: number }>>([]);
  const [tenderMethod, setTenderMethod] = useState<'not_recorded' | SaleTender['method']>('not_recorded');
  const [received, setReceived] = useState('');
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
  const positions = snapshot?.positions.filter((position) => position.closing > 0 && position.item.isActive && position.location.id === user?.locationId) ?? [];
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
      if (!user || !accessToken || !enabled || stored(user)) return;
      if (basket.length && itemId) throw new Error('Add the selected item to the basket before reviewing.');
      const lines = basket.length ? basket : [{ itemId, quantity: Number(quantity) }];
      if (!lines.length || lines.length > 100) throw new Error('Add between 1 and 100 items to the basket.');
      for (const choice of lines) {
        const position = positions.find(p => p.item.id === choice.itemId);
        if (!position || !Number.isSafeInteger(choice.quantity) || choice.quantity < 1 || choice.quantity > position.closing) throw new Error('Check basket quantities and refresh stock before reviewing.');
      }
      const generation = localStorage.getItem(generationKey(user)) ?? '';
      const preview = await api.quotePricingPreview(accessToken, lines);
      const movementDate = companyDay(settings?.timeZone);
      setCompleted(null);
      const nextQuote = await api.saleQuote(accessToken, { locationId: user.locationId ?? undefined, movementDate, lines: lines.map(choice => {
        const line = preview.lines.find(p => p.itemId === choice.itemId);
        const item = snapshot?.items.find(p => p.id === choice.itemId);
        if (!line || item?.sellingPriceCents == null) throw new Error('Ask an administrator to set a selling price for each basket item.');
        return { ...choice, expectedVersion: line.configurationVersion ?? line.pricingVersion ?? 0, expectedRetailPriceCents: item.sellingPriceCents };
      }) });
      if (generation !== (localStorage.getItem(generationKey(user)) ?? '')) throw new Error('Another sale request changed this checkout. Review a new quote.');
      reviewGeneration.current = generation; setQuote(nextQuote);
    });
  };
  const add = () => {
    const count = Number(quantity), previous = basket.find(line => line.itemId === itemId)?.quantity ?? 0;
    if (!selected || !Number.isSafeInteger(count) || count < 1 || count + previous > selected.closing) { setError('Enter a whole quantity within the available stock.'); return; }
    if (!previous && basket.length >= 100) { setError('A basket can contain up to 100 different items.'); return; }
    setBasket(current => previous ? current.map(line => line.itemId === itemId ? {...line, quantity:line.quantity + count} : line) : [...current,{itemId,quantity:count}]);
    setItemId(''); setQuantity(''); setQuote(null); setCompleted(null); setError(null);
  };
  const finish = async (sale: CompletedSale, request: Pending) => {
    if (!user) return;
    // Resolve the durable request before refreshing; failed refresh must never resubmit this sale.
    localStorage.removeItem(`${prefix(user)}${request.idempotencyKey}`);
    setPending(stored(user)); setQuote(null); setItemId(''); setQuantity(''); setBasket([]); setTenderMethod('not_recorded'); setReceived(''); setCompleted(sale);
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
      const amount = tenderMethod === 'unpaid' ? 0 : parseMoneyCents(received);
      if (tenderMethod !== 'not_recorded' && (amount === null || (tenderMethod === 'cash' && amount < quote.totalCents) || (tenderMethod === 'momo' && amount !== quote.totalCents))) throw new Error('Check the amount received. Cash must cover the total; MoMo must equal it.');
      const next: Pending = { idempotencyKey: crypto.randomUUID(), quoteToken: quote.quoteToken, ...(tenderMethod === 'not_recorded' ? {} : {tender:{method:tenderMethod,amountReceivedCents:amount!}}) };
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
    <PageHeader title="Sell" subtitle={`A sale reduces stock at ${shopName} only. Add items to one basket. Current prices apply automatically.`} />
    <Panel title={pending ? 'Confirm pending sale' : 'Record a sale'}><div className="checkout-body">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending ? <div>
        <p>The last request needs confirmation. Keep this request until its result is known.</p>
        <button className="button" disabled={busy} onClick={check}>Check sale status</button>
        <button className="button secondary" disabled={busy} onClick={() => void run(() => send(pending))}>Retry same sale</button>
      </div> : <form className="form-grid" onSubmit={review}>
        <fieldset disabled={busy || inventoryBusy || settingsLoading || !settings || !!inventoryError || !enabled}>
          <label><span>{terms.Item}</span><ProductPicker items={snapshot?.items.filter(item => item.isActive) ?? []} locationId={user?.locationId} selling value={itemId} onValueChange={(value) => { setItemId(value); setQuote(null); }} /></label>
          <label><span className="quantity-label">Quantity{selected && <small className="selected-availability">{selected.closing} {selected.item.unit} available at {shopName}</small>}</span><InputControl aria-label="Quantity" type="number" min="1" max={selected?.closing} value={quantity} onValueChange={(value) => { setQuantity(value); setQuote(null); }} /></label>
          <button className="button secondary" disabled={!selected} type="button" onClick={add}>Add to basket</button>
          {basket.length > 0 && <div className="checkout-basket" aria-label="Sale basket">{basket.map(line => {
            const item = snapshot?.items.find(i => i.id === line.itemId);
            const available = positions.find(p => p.item.id === line.itemId)?.closing ?? 0;
            const quoteLine = quote?.lines.find(l => l.itemId === line.itemId);
            const qtyId = `basket-qty-${line.itemId}`;
            return <div className="checkout-basket-line" key={line.itemId} role="group" aria-label={item?.name ?? 'Unavailable item'}>
              <b className="basket-line-name">{item?.name ?? 'Unavailable item'}</b>
              <p className="basket-line-meta">{available} {item?.unit} available{item?.sellingPriceCents != null && <> · {money(item.sellingPriceCents, settings?.currency ?? 'GHS')} each</>}</p>
              <div className="basket-line-qty"><label htmlFor={qtyId}>Quantity{item?.unit ? ` (${item.unit})` : ''}</label><InputControl id={qtyId} aria-label={`Quantity for ${item?.name}`} type="number" inputMode="numeric" min="1" max={available} required value={String(line.quantity || '')} onValueChange={value => { setBasket(current => current.map(l => l.itemId === line.itemId ? {...l,quantity:Number(value)} : l)); setQuote(null); }} /></div>
              {quoteLine && <p className="basket-line-total">Line total <b>{money(quoteLine.totalCents)}</b></p>}
              <button type="button" className="basket-remove" aria-label={`Remove ${item?.name}`} onClick={() => { setBasket(current => current.filter(l => l.itemId !== line.itemId)); setQuote(null); }}>Remove</button>
            </div>;
          })}</div>}
          <button className="button secondary" disabled={!basket.length && !selected} type="submit">Review sale</button>
          <button className="button secondary" type="button" onClick={() => void run(async () => { setQuote(null); await refresh(); })}>Refresh stock and prices</button>
        </fieldset>
      </form>}
      {!pending && quote && <div className="pricing-quote-result" role="status">
        <p>{quote.lines.length} {quote.lines.length === 1 ? 'item' : 'items'} · Stock and prices are checked again when you complete this sale.</p>
        <dl className="checkout-totals">
          {quote.automaticDiscountCents > 0 && <><div><dt>Price before discount</dt><dd>{money(quote.grossSalesCents)}</dd></div>
          <div className="checkout-discount"><dt>Discount</dt><dd>− {money(quote.automaticDiscountCents)}</dd></div></>}
          <div className="checkout-pay"><dt>Customer pays</dt><dd>{money(quote.totalCents)}</dd></div>
        </dl>
        {quote.lines.map(line => <section className="checkout-quote-line" key={line.itemId}><h3>{line.itemName}</h3><p>{line.quantity} {line.baseUnit} · {money(line.totalCents)}</p><div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Price used</th><th className="num">Quantity</th><th className="num">Each</th><th className="num">Total</th></tr></thead><tbody>{line.components.map((part, index) => <tr key={index}><td>{part.category === 'box' && line.package ? `${line.package.label.charAt(0).toUpperCase()}${line.package.label.slice(1)} price (${line.package.size} per ${line.package.label})` : pricingLabels[part.category]}</td><td className="num">{part.quantity}</td><td className="num">{money(part.unitPriceCents)}</td><td className="num">{money(part.totalCents)}</td></tr>)}</tbody></table></div></section>)}
        <div className="checkout-payment">
          <label><span>Payment record (manual)</span><SelectControl aria-label="Payment record (manual)" value={tenderMethod} disabled={busy} onValueChange={value => { setTenderMethod(value as typeof tenderMethod); setReceived(''); }} options={[{value:'not_recorded',label:'Payment not recorded'},{value:'cash',label:'Cash received'},{value:'momo',label:'MoMo received — confirmed manually'},{value:'unpaid',label:'Unpaid'}]} /></label>
          {(tenderMethod === 'cash' || tenderMethod === 'momo') && <label><span>Amount received ({quote.currency})</span><InputControl aria-label="Amount received" type="number" min="0" step="0.01" disabled={busy} value={received} onValueChange={setReceived} /></label>}
          {tenderMethod === 'cash' && parseMoneyCents(received) !== null && parseMoneyCents(received)! >= quote.totalCents && <p role="status">Change to give: {money(parseMoneyCents(received)! - quote.totalCents)}</p>}
          <p>{tenderMethod === 'unpaid' ? 'The full sale amount is still due. No payment has been recorded.' : tenderMethod === 'not_recorded' ? 'This sale will have no payment confirmation.' : 'Confirm the money was received before recording it. This does not collect or verify a payment.'}</p>
        </div>
        <button className="button" disabled={busy || !enabled || !!inventoryError} onClick={complete}>Complete sale</button>
      </div>}
      {completed && <div><p role="status">Sale recorded · {money(completed.totalCents, completed.currency)}</p><NavLink className="button secondary" to={`/sales/${completed.id}/receipt`}>View customer receipt</NavLink></div>}
    </div></Panel>
  </PageState>;
}
