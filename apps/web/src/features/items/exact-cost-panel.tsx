import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { formatMoney } from '../../lib/presentation';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { ExactCostInput, ExactCostRequest, ExactCostState } from '../../types';

const limit = 2147483647;
function cents(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(limit)) throw new Error('This test supports amounts up to 21,474,836.47.');
  return Number(result);
}

export function ExactCostPanel() {
  const { accessToken, user } = useAuth();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    if (accessToken && user?.role === 'administrator') void api.exactCostStatus(accessToken).then(s => { if (active) setVisible(s.hasEnrolledItems || !!localStorage.getItem(`stockledger:exact-cost-request:${user.companyId}:${user.id}`)); }).catch(() => { if (active) setVisible(false); });
    return () => { active = false; };
  }, [accessToken, user]);
  return visible && user ? <ExactCostWorkspace key={`${user.companyId}:${user.id}`} /> : null;
}

function ExactCostWorkspace() {
  const { accessToken, user } = useAuth();
  const { snapshot, refresh } = useInventoryStore();
  const storageKey = `stockledger:exact-cost-request:${user!.companyId}:${user!.id}`;
  const lockName = `stockledger:exact-cost:${user!.companyId}:${user!.id}`;
  const [reload, setReload] = useState(0);
  const [itemId, setItemId] = useState('');
  const [state, setState] = useState<ExactCostState | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [record, setRecord] = useState<ExactCostRequest | null>(null);
  const [mode, setMode] = useState<'receipt' | 'value_adjustment'>('receipt');
  const [value, setValue] = useState('');
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [free, setFree] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const load = () => {
      try {
        const key = localStorage.getItem(storageKey);
        if (key && !/^[a-f0-9-]{36}$/.test(key)) throw new Error('The pending request key cannot be read. Keep this browser data and contact support.');
        setPendingKey(key); setRecord(null); setState(null); setConfirmed(false);
      } catch (caught) { setError(safeErrorMessage(caught,'Could not load request recovery.')); }
    };
    load();
    const changed = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) load(); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [storageKey]);
  useEffect(() => {
    let active = true;
    if (accessToken && itemId && !pendingKey) void api.exactCost(accessToken,itemId).then(s => { if (active) { setConfirmed(false); setValue(''); setQuantity(''); setReference(''); setReason(''); setFree(false); setState(s); setLocationId(s.positions[0]?.locationId ?? ''); } }).catch(caught => { if (active) setError(safeErrorMessage(caught,'Could not load stock costs.')); });
    return () => { active = false; };
  }, [accessToken,itemId,pendingKey,reload]);
  useEffect(() => {
    let active = true;
    if (accessToken && pendingKey) void api.exactCostRequest(accessToken,pendingKey).then(r => { if (active) setRecord(previous => previous?.request?.key === pendingKey && (previous.request.status !== 'prepared' || !r.request) ? previous : r); }).catch(caught => { if (active) setError(safeErrorMessage(caught,'Could not check this request.')); });
    return () => { active = false; };
  }, [accessToken,pendingKey]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      if (!navigator.locks) throw new Error('This test requires a browser that supports safe request coordination.');
      await navigator.locks.request(lockName, async () => { if (alive.current) await action(); });
    } catch (caught) { if (alive.current) setError(safeErrorMessage(caught,'Could not confirm this request. Check its status before continuing.')); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const review = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!accessToken || !state || !confirmed) return;
      if (localStorage.getItem(storageKey)) { setPendingKey(localStorage.getItem(storageKey)); throw new Error('Resolve the pending request before starting another.'); }
      const kind = state.checkpoint ? mode : 'checkpoint';
      const amount = cents(value);
      const units = Number(quantity);
      if (kind === 'receipt' && (!/^\d+$/.test(quantity) || units < 1 || units > limit)) throw new Error('Enter a whole purchase quantity.');
      if (kind === 'receipt' && BigInt(units) * BigInt(amount) > BigInt(limit)) throw new Error('The purchase total exceeds this test’s amount limit.');
      const input: ExactCostInput = { kind,itemId:state.item.id,expectedItemUpdatedAt:state.item.updatedAt,expectedUnit:state.item.unit,expectedCurrency:state.currency,
        expectedQuantity:state.quantity,expectedSequence:state.sequence,reference:reference.trim(),confirmed:true,freeStockConfirmed:free,
        ...(kind === 'receipt' ? {locationId,quantity:units,unitCostCents:amount,movementDate:date,supplierId:null}
          : {valueCents:amount,...(kind === 'checkpoint' ? {costReviewId:state.costReview.review?.id ?? null} : {reason:reason.trim()})}) };
      const key = crypto.randomUUID();
      // Persist only an opaque recovery key. Purchase amounts stay on the server.
      localStorage.setItem(storageKey,key); setPendingKey(key); setRecord(null);
      const next = await api.prepareExactCost(accessToken,key,input);
      if (alive.current) setRecord(next);
    });
  };
  const check = () => void run(async () => {
    const key = localStorage.getItem(storageKey);
    if (!accessToken || !key) throw new Error('This request was resolved in another tab.');
    setPendingKey(key); setRecord(await api.exactCostRequest(accessToken,key));
  });
  const resolve = (cancel: boolean) => void run(async () => {
    const key = localStorage.getItem(storageKey);
    if (!accessToken || !key || key !== pendingKey) throw new Error('This request changed in another tab. Check its status.');
    setRecord(await (cancel ? api.cancelExactCost(accessToken,key) : api.applyExactCost(accessToken,key)));
    await refresh();
  });
  const clear = () => void run(async () => {
    if (!accessToken || !pendingKey) return;
    const result = await api.exactCostRequest(accessToken,pendingKey);
    if (!result.request || result.request.status === 'prepared') throw new Error('Confirm or cancel this request before continuing.');
    if (localStorage.getItem(storageKey) === pendingKey) localStorage.removeItem(storageKey);
    setRecord(null); setPendingKey(null); setState(null); setMessage(result.request.status === 'applied' ? 'Cost record saved.' : 'Request cancelled.');
    await refresh();
  });
  const items = snapshot?.items.filter(i => i.isActive) ?? [];
  const request = record?.request;
  const input = request?.input;
  const money = (n: number) => formatMoney(n, (input?.expectedCurrency as ExactCostState['currency'] | undefined) ?? state?.currency ?? 'GHS');
  const opening = !!state && !state.checkpoint;
  const zero = value !== '' && /^0+(\.0{1,2})?$/.test(value);
  const blocked = !state?.available || state.allowNegativeStock || state.hasNegativePosition || (opening && state.quantity > 0 && state.costReview.state !== 'confirmed');
  return <Panel title="Exact stock costs" subtitle="Test items only. Future purchases and sale costs preserve every cent." className="spaced exact-cost-panel">
    <div className="cost-review-body">
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <p role="status">{message}</p>}
      {pendingKey ? <div className="exact-cost-request">
        <p role="status">{request?.status === 'applied' ? 'Cost record saved.' : request?.status === 'cancelled' ? 'Request cancelled. No new cost record was applied.' : 'Review this cost request before continuing.'}</p>
        {input?.kind === 'stock_operation' && <p>Resolve this stock change under Movements → Exact stock changes.</p>}
        {input && input.kind !== 'stock_operation' && <dl className="exact-cost-summary">
          <div><dt>Action</dt><dd>{input.kind === 'checkpoint' ? 'Verify opening value' : input.kind === 'receipt' ? 'Record a purchase' : 'Correct current value'}</dd></div>
          <div><dt>Item</dt><dd>{items.find(i=>i.id===input.itemId)?.name ?? 'Selected item'}</dd></div>
          <div><dt>Quantity before</dt><dd>{input.expectedQuantity} {input.expectedUnit}</dd></div>
          {input.kind === 'receipt' && <><div><dt>Purchase quantity</dt><dd>{input.quantity} {input.expectedUnit}</dd></div><div><dt>Unit purchase cost</dt><dd>{money(input.unitCostCents!)}</dd></div><div><dt>Receive at</dt><dd>{snapshot?.locations.find(p=>p.id===input.locationId)?.name ?? 'Selected place'}</dd></div><div><dt>Purchase date</dt><dd>{input.movementDate}</dd></div></>}
          <div><dt>{input.kind === 'receipt' ? 'Purchase total' : 'Verified total stock value'}</dt><dd>{money(input.kind === 'receipt' ? input.quantity! * input.unitCostCents! : input.valueCents!)}</dd></div>
          <div><dt>Record reference</dt><dd>{input.reference}</dd></div>
          {input.kind === 'value_adjustment' && <div><dt>Reason</dt><dd>{input.reason}</dd></div>}
        </dl>}
        {!request && <p>The request may still be in progress. Check its status or cancel it before starting another.</p>}
        <div className="form-actions">
          {request?.status === 'prepared' && input?.kind !== 'stock_operation' && <button type="button" className="button" disabled={busy} onClick={()=>resolve(false)}>Confirm cost record</button>}
          {(!request || request.status === 'prepared') && <><button type="button" className="button secondary" disabled={busy} onClick={check}>Check request status</button><button type="button" className="button secondary" disabled={busy} onClick={()=>resolve(true)}>Cancel cost request</button></>}
          {request && request.status !== 'prepared' && <button type="button" className="button secondary" disabled={busy} onClick={clear}>Continue</button>}
        </div>
      </div> : <>
        <label><span>Item</span><SelectControl aria-label="Exact cost item" disabled={busy} value={itemId} onValueChange={id=>{setItemId(id);setState(null);setError(null);setMessage(null);}} options={[{value:'',label:'Select item'},...items.map(i=>({value:i.id,label:i.name}))]} /></label>
        {state && <>
          <p>Stock on hand: <strong>{state.quantity} {state.item.unit}</strong>{state.valueCents !== null && <> · Total value: <strong>{money(state.valueCents)}</strong></>}</p>
          {state.checkpoint && <p>Average unit cost: {money(state.item.unitCostCents)}. The total value keeps the exact cents.</p>}
          {blocked && <p role="status">{!state.available ? 'New cost records are disabled. Existing values remain available.' : state.allowNegativeStock || state.hasNegativePosition ? 'Resolve negative stock before enabling exact costs.' : 'Confirm this item under Review purchase costs first, then reload its value.'}</p>}
          <button type="button" className="button secondary" disabled={busy} onClick={()=>{setState(null);setError(null);setReload(r=>r+1);}}>Reload stock costs</button>
          <form onSubmit={review} className="cost-review-form"><fieldset disabled={busy || blocked}>
            {opening ? <h3>Verify opening value</h3> : <label><span>Action</span><SelectControl aria-label="Exact cost action" value={mode} onValueChange={next=>{setMode(next as typeof mode);setValue('');setConfirmed(false);setFree(false);}} options={[{value:'receipt',label:'Record a purchase'},{value:'value_adjustment',label:'Correct current value'}]} /></label>}
            {!opening && mode === 'receipt' && <>
              <label><span>Receive at</span><SelectControl aria-label="Receive at" required value={locationId} onValueChange={setLocationId} options={state.positions.map(p=>({value:p.locationId,label:p.name}))} /></label>
              <label><span>Purchase quantity</span><InputControl inputMode="numeric" required value={quantity} onValueChange={setQuantity} /></label>
              <label><span>Purchase date</span><InputControl type="date" required value={date} onValueChange={setDate} /></label>
            </>}
            <label><span>{!opening && mode === 'receipt' ? 'Unit purchase cost' : 'Verified total stock value'} ({state.currency})</span><InputControl inputMode="decimal" required value={value} onValueChange={setValue} /></label>
            {opening && <p>Use the total supported by your records. The displayed rounded unit cost cannot verify an opening value.</p>}
            <label><span>Cost record reference</span><InputControl required maxLength={200} value={reference} onValueChange={setReference} /></label>
            {!opening && mode === 'value_adjustment' && <label><span>Correction reason</span><InputControl required maxLength={200} value={reason} onValueChange={setReason} /></label>}
            {zero && ((opening && state.quantity > 0) || (!opening && mode === 'receipt')) && <label className="pricing-checkbox"><input required type="checkbox" checked={free} onChange={e=>setFree(e.target.checked)} />This stock was acquired free of charge.</label>}
            <label className="pricing-checkbox"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />I checked the quantity and value against the referenced records.</label>
            <button type="submit" className="button" disabled={!confirmed || !value || !reference.trim()}>Review cost record</button>
          </fieldset></form>
        </>}
      </>}
    </div>
  </Panel>;
}
