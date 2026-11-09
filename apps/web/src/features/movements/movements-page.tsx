import { SaleSearchFields, type SaleSearch } from './sale-search';
import { ProductPicker } from '../../components/ui/product-picker';
import { Dialog } from '@base-ui/react/dialog';
import { DatePicker } from '../../components/ui/date-picker';
import { DateRangePicker } from '../../components/ui/date-range-picker';
import { companyDay, rangeQuery, type DateRangeValue } from '../../lib/date-range';
import { HybridOperationsPanels } from './hybrid-operations-panels';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InfoTooltip } from '../../components/ui/info-tooltip';
import { InputControl } from '../../components/ui/input-control';
import { AsyncActionButton } from '../../components/ui/async-action-button';
import { useAsyncActionState } from '../../components/ui/use-async-action-state';
import { safeErrorMessage } from '../../lib/user-facing-error';
import { movementMeta, parseMoneyCents } from '../../lib/presentation';
import type { Movement, MovementType, ReturnableSale, Supplier } from '../../types';

const LEDGER_PAGE = 50;

export function MovementsPage() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { money, calendarDate, settings, terms } = useCompanySettings();
  const saveAction = useAsyncActionState();
  const [range, setRange] = useState<DateRangeValue>({ days: null });
  const [filter, setFilter] = useState<'all' | MovementType>('all');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Items can link here with ?item= to record a purchase for that item.
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({
    itemId: searchParams.get('item') ?? '',
    locationId: searchParams.get('place') ?? '',
    destinationLocationId: searchParams.get('destination') ?? '',
    type: (searchParams.get('type') === 'transfer' ? 'transfer' : 'purchase') as MovementType,
    quantity: '',
    movementDate: companyDay(settings?.timeZone),
    reference: '',
    note: '',
    unitCost: '',
    supplierId: '',
    relatedMovementId: '',
  });
  const items = snapshot?.items.filter((item) => item.isActive) ?? [];
  const places = snapshot?.locations ?? [];
  const selectedItem = items.find(item => item.id === form.itemId);
  const selectedPlace = places.find(place => place.id === form.locationId);
  const currentStock = snapshot?.positions.find(position => position.item.id === form.itemId && position.location.id === form.locationId)?.closing ?? 0;
  const receiptQuantity = Number(form.quantity);
  const receiptUnitCost = parseMoneyCents(form.unitCost);
  const receiptTotal = Number.isSafeInteger(receiptQuantity) && receiptQuantity > 0 && receiptUnitCost !== null ? receiptQuantity * receiptUnitCost : null;
  const receiptReady = Boolean(selectedItem && selectedPlace && receiptTotal !== null && Number.isSafeInteger(receiptTotal));
  const [ledger, setLedger] = useState<{ rows: Movement[]; total: number } | null>(null);
  const [deleting, setDeleting] = useState<Movement | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const cancelDelete = useRef<HTMLButtonElement | null>(null);
  const ledgerFocus = useRef<HTMLHeadingElement | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saleSearch, setSaleSearch] = useState<SaleSearch>({});
  const [sales, setSales] = useState<ReturnableSale[]>([]);
  const rows = ledger?.rows ?? [];
  const selectedSale = sales.find((sale) => sale.id === form.relatedMovementId);
  const returnableQuantity = selectedSale?.returnableQuantity;
  const generatedAt = snapshot?.generatedAt;

  useEffect(() => {
    if (!accessToken) return;
    void api.suppliers(accessToken).then(setSuppliers).catch(() => toast.error('Could not load suppliers'));
  }, [accessToken]);

  // Reload the first ledger page whenever the filter changes or a mutation refreshes the snapshot.
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void api.movementLedger(accessToken, { ...rangeQuery(range, settings?.timeZone), type: filter === 'all' ? undefined : filter, offset: 0, limit: LEDGER_PAGE })
      .then((page) => { if (active) setLedger({ rows: page.movements, total: page.total }); })
      .catch(() => { if (active) toast.error('Could not load the movement ledger'); });
    void api.returnableSales(accessToken, saleSearch)
      .then((next) => { if (active) setSales(next); })
      .catch(() => { if (active) setSales([]); });
    return () => { active = false; };
  }, [accessToken, filter, generatedAt, range, settings?.timeZone, saleSearch]);

  const loadMore = async () => {
    if (!accessToken || !ledger) return;
    setLoadingMore(true);
    try {
      const page = await api.movementLedger(accessToken, { ...rangeQuery(range, settings?.timeZone), type: filter === 'all' ? undefined : filter, offset: ledger.rows.length, limit: LEDGER_PAGE });
      setLedger((current) => current && { rows: [...current.rows, ...page.movements], total: page.total });
    } catch {
      toast.error('Could not load more movements');
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await saveAction.run(() => mutate(() => api.addMovement(accessToken, {
      itemId: form.itemId,
      locationId: form.locationId,
      destinationLocationId: form.type === 'transfer' ? form.destinationLocationId : undefined,
      type: form.type,
      quantity: Number(form.quantity),
      movementDate: form.movementDate,
      reference: form.reference,
      note: form.note,
      unitCostCents: form.type === 'purchase' ? Math.round(Number(form.unitCost) * 100) : undefined,
      supplierId: form.type === 'purchase' && form.supplierId ? form.supplierId : undefined,
      relatedMovementId: form.type === 'return_in' ? form.relatedMovementId : undefined,
    }), `${movementMeta[form.type].label} was recorded.`));
    setForm((current) => ({ ...current, quantity: '', reference: '', note: '', unitCost: '', relatedMovementId: '' }));
  };

  return <PageState>
    <PageHeader title="Stock movements" actions={<><NavLink className="button secondary" to="/stock-counts">Count stock</NavLink><NavLink className="button secondary" to="/suppliers">Suppliers</NavLink></>} />
    {/* The everyday form stays first; flagged workflows load afterwards without pushing it down. */}
    <Panel title={form.type === 'purchase' ? 'Receive stock' : 'Record movement'}>
      <form className="form-grid movement-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>{terms.Item}</span><ProductPicker items={items} locationId={form.locationId} required value={form.itemId} disabled={form.type === 'return_in'} onValueChange={(itemId) => setForm({ ...form, itemId })} /></label>
        <label><span className="label-row"><span>Movement type</span><InfoTooltip label="About movement type">{movementMeta[form.type].hint}</InfoTooltip></span><SelectControl aria-label="Movement type" value={form.type} onValueChange={(value) => setForm({ ...form, type: value as MovementType, destinationLocationId: '', relatedMovementId: '', itemId: value === 'return_in' ? '' : form.itemId, locationId: value === 'return_in' ? '' : form.locationId })} options={(Object.entries(movementMeta) as [MovementType, { label: string; hint: string }][]).filter(([value]) => value !== 'sale' && value !== 'adjustment_in' && value !== 'adjustment_out').map(([value, meta]) => ({ value, label: value === 'purchase' ? 'Receive stock' : meta.label }))} /></label>
        {form.type === 'return_in' && <SaleSearchFields value={saleSearch} onChange={setSaleSearch} count={sales.length} />}
        {form.type === 'return_in' && <label><span>Original sale</span><SelectControl aria-label="Original sale" required value={form.relatedMovementId} onValueChange={(relatedMovementId) => { const sale = sales.find((candidate) => candidate.id === relatedMovementId); setForm({ ...form, relatedMovementId, itemId: sale?.itemId ?? '', locationId: sale?.locationId ?? '', quantity: '' }); }} options={[{ value: '', label: 'Select sale' }, ...sales.map((sale) => ({ value: sale.id, label: `${sale.item?.name ?? 'Deleted item'} · ${sale.returnableQuantity} returnable · ${sale.movementDate}` }))]} /></label>}
        <label><span>{form.type === 'transfer' ? 'From' : 'Place'}</span><SelectControl aria-label={form.type === 'transfer' ? 'From' : 'Place'} required value={form.locationId} disabled={form.type === 'return_in'} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select place' }, ...places.map((place) => ({ value: place.id, label: place.name }))]} /></label>
        {form.type === 'transfer' && <label><span>To</span><SelectControl aria-label="To" required value={form.destinationLocationId} onValueChange={(destinationLocationId) => setForm({ ...form, destinationLocationId })} options={[{ value: '', label: 'Select place' }, ...places.filter((place) => place.id !== form.locationId).map((place) => ({ value: place.id, label: place.name }))]} /></label>}
        <label><span>{form.type === 'purchase' ? `Quantity received${selectedItem ? ` (${selectedItem.unit})` : ''}` : 'Quantity'}</span><InputControl type="number" min="1" max={returnableQuantity} required value={form.quantity} onValueChange={(quantity) => setForm({ ...form, quantity })} /></label>
        {form.type === 'purchase' && <label><span>{selectedItem ? `Cost per ${selectedItem.unit} (${settings?.currency ?? 'GHS'})` : 'Unit cost'}</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(unitCost) => setForm({ ...form, unitCost })} /></label>}
        <label><span>Date</span><DatePicker label="Date" required value={form.movementDate} onValueChange={(movementDate) => setForm({ ...form, movementDate })} /></label>
        {form.type === 'purchase' ? <>
          <div className="receipt-save-bar"><div role="status" aria-label="Receipt preview">{receiptReady ? <><b>{receiptQuantity} {selectedItem!.unit} × {money(receiptUnitCost!)} = {money(receiptTotal!)}</b><p>{selectedPlace!.name}: {currentStock} → {currentStock + receiptQuantity} {selectedItem!.unit}</p><small>Current stock preview. The receipt is recorded on the selected date.</small></> : <p>Choose an item and place, then enter quantity and cost to preview this receipt.</p>}</div><AsyncActionButton disabled={busy || !items.length} idleLabel="Save receipt" pendingLabel="Saving receipt" state={saveAction.state} successLabel="Saved" /></div>
          <details className="delivery-details" open={settings?.requirePurchaseSource || undefined}><summary>{settings?.requirePurchaseSource ? 'Delivery details — supplier or reference required' : 'Optional delivery details'}</summary><div className="form-grid"><label><span>Supplier</span><SelectControl aria-label="Supplier" value={form.supplierId} onValueChange={(supplierId) => setForm({ ...form, supplierId })} options={[{ value: '', label: 'No supplier' }, ...suppliers.filter((supplier) => supplier.isActive).map((supplier) => ({ value: supplier.id, label: supplier.name }))]} /></label><label><span>Reference</span><InputControl required={Boolean(settings?.requirePurchaseSource && !form.supplierId)} value={form.reference} onValueChange={(reference) => setForm({ ...form, reference })} /></label><label><span>Note</span><InputControl value={form.note} onValueChange={(note) => setForm({ ...form, note })} /></label></div></details>
        </> : <><label><span>Reference</span><InputControl value={form.reference} onValueChange={(reference) => setForm({ ...form, reference })} /></label><label><span>Note</span><InputControl required={Boolean(form.type === 'damage' && settings?.requireAdjustmentReason)} value={form.note} onValueChange={(note) => setForm({ ...form, note })} /></label><AsyncActionButton disabled={busy || !items.length} idleLabel="Save movement" pendingLabel="Saving" state={saveAction.state} successLabel="Saved" /></>}

      </form>
    </Panel>
    <HybridOperationsPanels />
    <Panel headingRef={ledgerFocus} title={`Movement ledger (${ledger?.total ?? 0})`} className="spaced">
      <div className="filter-row"><DateRangePicker allowAll value={range} onChange={setRange} /><label><span className="sr-only">Filter movement type</span><SelectControl aria-label="Filter movement type" value={filter} onValueChange={(value) => setFilter(value as typeof filter)} options={[{ value: 'all', label: 'All movement types' }, ...Object.entries(movementMeta).map(([value, meta]) => ({ value, label: meta.label }))]} /></label></div>
      {rows.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Place</th><th>Reference</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Sale total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((movement) => <tr key={movement.id}><td>{calendarDate(movement.movementDate)}</td><td><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movement.note}</small></td><td>{movement.correctsMovementId ? 'Purchase correction' : movementMeta[movement.type].label}</td><td>{movement.destination ? `${movement.location?.name ?? 'Unknown'} → ${movement.destination.name}` : movement.location?.name ?? 'Unknown'}</td><td>{movement.reference || suppliers.find((supplier) => supplier.id === movement.supplierId)?.name || '—'}</td><td className={`num ${movement.sign === 1 ? 'positive' : 'negative'}`}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</td><td className="num">{movement.unitCostCents == null ? '—' : money(movement.unitCostCents)}</td><td className="num">{movement.saleTotalCents == null ? '—' : money(movement.saleTotalCents)}</td><td className="num">{movement.correctsMovementId || movement.correctedByMovementId ? <span className="account-owner-label">{movement.correctsMovementId ? 'Correction' : 'Corrected'}</span> : movement.saleId ? <span className="account-owner-label">Reversal required</span> : movement.stockCountId ? <span className="account-owner-label">Counted</span> : <button className="icon-button" aria-label={`Correct movement for ${movement.item?.name ?? 'deleted item'}`} disabled={busy} onClick={event => { deleteTrigger.current = event.currentTarget; setDeleteError(null); setDeleting(movement); }}><Trash2 size={16} /></button>}</td></tr>)}</tbody></table></div> : ledger ? <EmptyState text="No movements match this filter." /> : <div className="empty"><p>Loading movements</p></div>}
      {ledger && rows.length < ledger.total && <div className="ledger-more"><button className="button secondary" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? 'Loading' : `Show more (${ledger.total - rows.length} left)`}</button></div>}
    </Panel>
    <Dialog.Root open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}>
      <Dialog.Portal><Dialog.Backdrop className="team-share-backdrop" /><Dialog.Viewport className="team-share-viewport">
        <Dialog.Popup className="team-share-dialog movement-correction-dialog" initialFocus={cancelDelete} finalFocus={() => deleteTrigger.current?.isConnected ? deleteTrigger.current : ledgerFocus.current}>
          {deleting && <>
            <div className="team-share-heading"><div><Dialog.Title>Remove this {deleting.type === 'purchase' ? 'receipt' : 'movement'}?</Dialog.Title><Dialog.Description>{deleting.type === 'purchase' ? 'This adds a correction today that removes the receipt’s quantity and recorded value. The original receipt stays in history. This cannot be undone here.' : deleting.type === 'sale' ? 'This records a return today at the original sale cost for its remaining returnable units. The original sale stays in history.' : 'Check this record before removing it. This cannot be undone here.'}</Dialog.Description></div></div>
            <dl className="movement-correction-details">
              <div><dt>Item</dt><dd>{deleting.item?.name ?? 'Deleted item'} · {deleting.item?.sku}</dd></div>
              <div><dt>Record</dt><dd>{movementMeta[deleting.type].label} · {calendarDate(deleting.movementDate)} · {deleting.quantity} {deleting.item?.unit ?? 'units'}</dd></div>
              <div><dt>Place</dt><dd>{deleting.location?.name ?? 'Unknown'}{deleting.destination && ` → ${deleting.destination.name}`}</dd></div>
              {deleting.reference && <div><dt>Reference</dt><dd>{deleting.reference}</dd></div>}
              {deleting.note && <div><dt>Note</dt><dd>{deleting.note}</dd></div>}
              {deleting.unitCostCents !== null && <div><dt>Recorded unit cost</dt><dd>{money(deleting.unitCostCents)}</dd></div>}
              {deleting.type === 'purchase' && deleting.unitCostCents !== null && <div><dt>Receipt amount to remove</dt><dd>{money(deleting.costTotalCents ?? deleting.unitCostCents * deleting.quantity)}</dd></div>}
              {deleting.saleTotalCents !== null && <div><dt>Recorded sale total to remove</dt><dd>{money(deleting.saleTotalCents)}</dd></div>}
            </dl>
            <p className="movement-correction-effect">{deleting.type === 'transfer'
              ? `Stock increases by ${deleting.quantity} at ${deleting.location?.name ?? 'the source'} and decreases by ${deleting.quantity} at ${deleting.destination?.name ?? 'the destination'}.`
              : `Stock ${['purchase', 'return_in', 'adjustment_in'].includes(deleting.type) ? 'decreases' : 'increases'} by ${deleting.quantity} at ${deleting.location?.name ?? 'this place'}.`} {deleting.type === 'purchase' ? 'The remaining stock value and future sale costs will use the corrected balance. Past sales and reports keep their recorded costs. Receipts needed by later movements or whose value has been consumed cannot be corrected.' : 'Records needed by later stock movements cannot be removed.'}</p>
            {deleteError && <p role="alert" className="form-error">{deleteError}</p>}
            <div className="dialog-actions"><Dialog.Close ref={cancelDelete} className="button secondary" disabled={busy}>Cancel</Dialog.Close><button className="button danger-button" disabled={busy} onClick={() => {
              if (!accessToken) return;
              setDeleteError(null);
              void mutate(() => api.deleteMovement(accessToken, deleting.id), deleting.type === 'purchase' ? 'Purchase correction recorded. The original receipt stays in history.' : deleting.type === 'sale' ? 'Sale correction recorded. The original sale stays in history.' : 'The stock movement was removed.').then(() => { deleteTrigger.current = null; setDeleting(null); }).catch(caught => setDeleteError(safeErrorMessage(caught, 'Could not remove this movement. Try again.')));
            }}>{busy ? 'Removing…' : deleting.type === 'purchase' ? 'Remove this receipt' : 'Remove this movement'}</button></div>
          </>}
        </Dialog.Popup>
      </Dialog.Viewport></Dialog.Portal>
    </Dialog.Root>
  </PageState>;
}
