import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { formatMoney } from '../../lib/presentation';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { Currency, ExactCostState } from '../../types';
import { OperationButtons, useDurableOperation } from './durable-operation';
export type ReturnSource = {
  sourceType: 'grouped' | 'legacy';
  sourceId: string;
  revision: string;
  currency: Currency;
  lines: Array<{ itemId: string; name: string; unit: string; remainingQuantity: number; costKnown: boolean }>;
};
export type StockState = Omit<ExactCostState, 'costReview'> & {
  receipts: Array<{
    id: string;
    quantity: number;
    locationId: string;
    reference: string | null;
    date: string;
    unitCostCents: number | null;
  }>;
};
export function HybridOperationsPanels() {
  const { user, accessToken } = useAuth();
  const [returns, setReturns] = useState(false),
    [stock, setStock] = useState(false);
  useEffect(() => {
    let active = true;
    if (accessToken && user?.role !== 'shop_attendant') {
      if (user?.role === 'administrator')
        void api
          .returnSources(accessToken)
          .then((r) => {
            if (active)
              setReturns(
                r.available ||
                  !!localStorage.getItem(`stockledger:return-request:${user.companyId}:${user.id}`),
              );
          })
          .catch(() => {});
      void api
        .stockOperationStatus(accessToken)
        .then((r) => {
          if (active)
            // Exact stock changes only matter for items already enrolled in exact costs.
            setStock(
              (r.available && r.hasEnrolledItems) ||
                !!localStorage.getItem(`stockledger:exact-cost-request:${user!.companyId}:${user!.id}`),
            );
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [accessToken, user]);
  return (
    <>
      {returns && <CustomerReturns key={`returns:${user!.id}`} />}
      {stock && <StockOperations key={`stock:${user!.id}`} />}
    </>
  );
}
function checkedMoney(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > 2147483647n) throw new Error('This amount exceeds the supported limit.');
  return Number(amount);
}
function CustomerReturns() {
  const { accessToken } = useAuth();
  const { snapshot } = useInventoryStore();
  const operation = useDurableOperation('return');
  const [sources, setSources] = useState<
      Array<{ id: string; type: 'grouped' | 'legacy'; date: string; reference: string }>
    >([]),
    [selected, setSelected] = useState(''),
    [source, setSource] = useState<ReturnSource | null>(null),
    [choices, setChoices] = useState<
      Record<string, { quantity: string; disposition: 'resellable' | 'damaged' }>
    >({}),
    [mode, setMode] = useState<'return' | 'reversal'>('return'),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (accessToken)
      void api
        .returnSources(accessToken)
        .then((r) => {
          if (active) setSources(r.sources);
        })
        .catch((e) => {
          if (active) setError(safeErrorMessage(e, 'Could not load original sales.'));
        });
    return () => {
      active = false;
    };
  }, [accessToken, operation.generation]);
  useEffect(() => {
    let active = true;
    if (accessToken && selected && !operation.key) {
      const [type, id] = selected.split(':');
      void api
        .returnSource(accessToken, type!, id!)
        .then((r) => {
          if (active) {
            setSource(r);
            setChoices({});
            setConfirmed(false);
            setReference('');
            setReason('');
          }
        })
        .catch((e) => {
          if (active) setError(safeErrorMessage(e, 'Could not load original allocations.'));
        });
    }
    return () => {
      active = false;
    };
  }, [accessToken, selected, operation.key, operation.generation]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!source || !confirmed) return;
    const lines = source.lines
      .filter((l) => l.remainingQuantity > 0)
      .map((l) => ({
        itemId: l.itemId,
        quantity: mode === 'reversal' ? l.remainingQuantity : Number(choices[l.itemId]?.quantity ?? 0),
        disposition: choices[l.itemId]?.disposition ?? 'resellable',
      }))
      .filter((l) => l.quantity > 0);
    if (!lines.length) {
      setError('Choose at least one whole return quantity.');
      return;
    }
    setError(null);
    void operation.start({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      kind: mode,
      expectedRevision: source.revision,
      movementDate: date,
      reference,
      reason,
      confirmed: true,
      lines,
    });
  };
  const record = operation.record?.request,
    preview = record?.preview;
  const grouped = new Map<
    string,
    { itemId: string; quantity: number; refundCents: number; disposition: string }
  >();
  for (const allocation of preview?.allocations ?? []) {
    const key = `${allocation.itemId}:${allocation.disposition}`,
      previous = grouped.get(key);
    grouped.set(
      key,
      previous
        ? {
            ...previous,
            quantity: previous.quantity + allocation.quantity,
            refundCents: previous.refundCents + allocation.refundCents,
          }
        : allocation,
    );
  }
  const previewRows = [...grouped.values()];
  return (
    <Panel
      title="Customer returns"
      subtitle="Use the original sale’s prices and costs. Recording a return does not send the refund."
      className="spaced customer-returns-panel"
    >
      <div className="cost-review-body">
        {(operation.error || error) && (
          <div className="form-error" role="alert">
            {operation.error || error}
          </div>
        )}
        {operation.key ? (
          <>
            <p role="status">
              {record?.status === 'applied'
                ? 'Return recorded. Refund payment has not been processed.'
                : record?.status === 'cancelled'
                  ? 'Request cancelled.'
                  : 'Review the original refund amount before confirming.'}
            </p>
            {record?.input && (
              <p>
                Reference: {String(record.input.reference)} · {String(record.input.movementDate)}
                <br />
                Reason: {String(record.input.reason)}
              </p>
            )}
            {preview && (
              <>
                <p>
                  Refund amount:{' '}
                  <strong>{formatMoney(preview.refundCents, preview.currency as Currency)}</strong>
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Stock outcome</th>
                        <th>Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((a, i) => (
                        <tr key={i}>
                          <td>
                            {snapshot?.items.find((item) => item.id === a.itemId)?.name ?? 'Original item'}
                          </td>
                          <td>{a.quantity}</td>
                          <td>
                            {a.disposition === 'resellable'
                              ? 'Return to stock'
                              : 'Damaged — no sellable stock'}
                          </td>
                          <td className="num">{formatMoney(a.refundCents, preview.currency as Currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <OperationButtons operation={operation} />
          </>
        ) : (
          <>
            <label>
              <span>Original sale</span>
              <SelectControl
                aria-label="Return original sale"
                disabled={operation.busy}
                value={selected}
                onValueChange={(id) => {
                  setSelected(id);
                  setSource(null);
                  setError(null);
                }}
                options={[
                  { value: '', label: 'Choose original sale' },
                  ...sources.map((s) => ({
                    value: `${s.type}:${s.id}`,
                    label: `${s.reference} · ${s.date}`,
                  })),
                ]}
              />
            </label>
            {source && (
              <form className="cost-review-form" onSubmit={submit}>
                <fieldset disabled={operation.busy}>
                  <label>
                    <span>Action</span>
                    <SelectControl
                      aria-label="Return action"
                      value={mode}
                      onValueChange={(value) => {
                        setMode(value as typeof mode);
                        setConfirmed(false);
                      }}
                      options={[
                        { value: 'return', label: 'Return selected units' },
                        { value: 'reversal', label: 'Reverse remaining sale' },
                      ]}
                    />
                  </label>
                  {source.lines
                    .filter((l) => l.remainingQuantity > 0)
                    .map((line) => (
                      <div className="return-item-fields" key={line.itemId}>
                        <p>
                          <strong>{line.name}</strong> · {line.remainingQuantity} {line.unit} returnable
                        </p>
                        {!line.costKnown ? (
                          <p>Original cost or price is missing. This workflow cannot invent it.</p>
                        ) : (
                          <>
                            <label>
                              <span>Return quantity — {line.name}</span>
                              <InputControl
                                inputMode="numeric"
                                min={0}
                                max={line.remainingQuantity}
                                type="number"
                                step={1}
                                value={
                                  mode === 'reversal'
                                    ? String(line.remainingQuantity)
                                    : (choices[line.itemId]?.quantity ?? '')
                                }
                                disabled={mode === 'reversal'}
                                onValueChange={(quantity) =>
                                  setChoices({
                                    ...choices,
                                    [line.itemId]: {
                                      quantity,
                                      disposition: choices[line.itemId]?.disposition ?? 'resellable',
                                    },
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Condition — {line.name}</span>
                              <SelectControl
                                aria-label={`Return condition ${line.name}`}
                                value={choices[line.itemId]?.disposition ?? 'resellable'}
                                onValueChange={(value) =>
                                  setChoices({
                                    ...choices,
                                    [line.itemId]: {
                                      quantity: choices[line.itemId]?.quantity ?? '',
                                      disposition: value as 'resellable' | 'damaged',
                                    },
                                  })
                                }
                                options={[
                                  { value: 'resellable', label: 'Can be resold' },
                                  { value: 'damaged', label: 'Damaged — do not restock' },
                                ]}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    ))}
                  <label>
                    <span>Return date</span>
                    <InputControl required type="date" value={date} onValueChange={setDate} />
                  </label>
                  <label>
                    <span>Return reference</span>
                    <InputControl required maxLength={200} value={reference} onValueChange={setReference} />
                  </label>
                  <label>
                    <span>Return reason</span>
                    <InputControl required maxLength={200} value={reason} onValueChange={setReason} />
                  </label>
                  <label className="pricing-checkbox">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I checked the returned quantity and condition.
                  </label>
                  <button
                    className="button"
                    disabled={!confirmed || !reference.trim() || !reason.trim()}
                    type="submit"
                  >
                    Review return
                  </button>
                </fieldset>
              </form>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
function StockOperations() {
  const { accessToken } = useAuth();
  const { snapshot } = useInventoryStore();
  const pending = useDurableOperation('stock');
  const [itemId, setItemId] = useState(''),
    [current, setCurrent] = useState<StockState | null>(null),
    [action, setAction] = useState('transfer'),
    [place, setPlace] = useState(''),
    [destination, setDestination] = useState(''),
    [quantity, setQuantity] = useState(''),
    [unitCost, setUnitCost] = useState(''),
    [original, setOriginal] = useState(''),
    [credit, setCredit] = useState(''),
    [free, setFree] = useState(false),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (accessToken && itemId && !pending.key)
      void api
        .stockOperationItem(accessToken, itemId)
        .then((c) => {
          if (active) {
            setCurrent(c);
            setPlace((c.positions.find((p) => p.quantity > 0) ?? c.positions[0])?.locationId ?? '');
            setDestination('');
            setQuantity('');
            setUnitCost('');
            setOriginal('');
            setConfirmed(false);
            setReference('');
            setReason('');
          }
        })
        .catch((e) => {
          if (active) setError(safeErrorMessage(e, 'Could not load exact stock.'));
        });
    return () => {
      active = false;
    };
  }, [accessToken, itemId, pending.key, pending.generation]);
  const atPlace = current?.positions.find((p) => p.locationId === place)?.quantity ?? 0,
    gain = action === 'count' && Number(quantity) > atPlace,
    needsReceipt = action === 'supplier_return' || action === 'receipt_reversal';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!current || !confirmed) return;
    try {
      if (!/^\d+$/.test(quantity) || Number(quantity) > 2147483647)
        throw new Error('Enter a whole quantity.');
      const input = {
        kind: 'stock_operation',
        itemId,
        operation: action,
        expectedItemUpdatedAt: current.item.updatedAt,
        expectedUnit: current.item.unit,
        expectedCurrency: current.currency,
        expectedQuantity: current.quantity,
        expectedSequence: current.sequence,
        expectedLocationQuantity: atPlace,
        locationId: place,
        destinationLocationId: action === 'transfer' ? destination : null,
        quantity: Number(quantity),
        unitCostCents: gain ? checkedMoney(unitCost) : null,
        freeStockConfirmed: free,
        originalMovementId: needsReceipt ? original : null,
        supplierCreditCents: needsReceipt && credit ? checkedMoney(credit) : null,
        reference,
        reason,
        movementDate: date,
        confirmed: true,
      };
      setError(null);
      void pending.start(input);
    } catch (e) {
      setError(safeErrorMessage(e, 'Check the stock details.'));
    }
  };
  const request = pending.record?.request,
    input = request?.input,
    preview = input?.preparedPreview as
      { quantityAfter: number; valueAfterCents: number; valueDeltaCents: number } | undefined;
  const items = snapshot?.items.filter((i) => i.isActive && i.preciseCosting) ?? [];
  return (
    <Panel
      title="Exact stock changes"
      subtitle="Transfers, losses and counts preserve the item’s exact carrying value."
      className="spaced exact-stock-panel"
    >
      <div className="cost-review-body">
        {(pending.error || error) && (
          <div className="form-error" role="alert">
            {pending.error || error}
          </div>
        )}
        {pending.key ? (
          <>
            <p role="status">
              {request?.status === 'applied'
                ? 'Stock change recorded.'
                : request?.status === 'cancelled'
                  ? 'Request cancelled.'
                  : 'Review the stock change before confirming.'}
            </p>
            {input?.kind !== 'stock_operation' && request ? (
              <p>Resolve this purchase or cost correction under Items → Exact stock costs.</p>
            ) : (
              input && (
                <>
                  <p>
                    {String(input.operation).replaceAll('_', ' ')} ·{' '}
                    {snapshot?.items.find((i) => i.id === input.itemId)?.name ?? 'Selected item'}
                  </p>
                  <p>
                    Quantity: {String(input.quantity)} · Reference: {String(input.reference)}
                  </p>
                  <p>
                    Place:{' '}
                    {snapshot?.locations.find((p) => p.id === input.locationId)?.name ?? 'Selected place'}
                    {!!input.destinationLocationId && (
                      <>
                        {' '}
                        →{' '}
                        {snapshot?.locations.find((p) => p.id === input.destinationLocationId)?.name ??
                          'Selected destination'}
                      </>
                    )}{' '}
                    · {String(input.movementDate)}
                  </p>
                  <p>Reason: {String(input.reason)}</p>
                  {preview && (
                    <p>
                      Stock after: <strong>{preview.quantityAfter}</strong> · Total value after:{' '}
                      <strong>
                        {formatMoney(preview.valueAfterCents, input.expectedCurrency as Currency)}
                      </strong>
                    </p>
                  )}
                  {input.supplierCreditCents != null && (
                    <p>
                      Supplier credit noted:{' '}
                      {formatMoney(Number(input.supplierCreditCents), input.expectedCurrency as Currency)}. No
                      credit payment is processed.
                    </p>
                  )}
                </>
              )
            )}
            <OperationButtons operation={pending} canApply={input?.kind === 'stock_operation'} />
          </>
        ) : (
          <>
            <label>
              <span>Item</span>
              <SelectControl
                aria-label="Exact stock item"
                value={itemId}
                disabled={pending.busy}
                onValueChange={(id) => {
                  setItemId(id);
                  setCurrent(null);
                  setError(null);
                }}
                options={[
                  { value: '', label: 'Select exact-cost item' },
                  ...items.map((i) => ({ value: i.id, label: i.name })),
                ]}
              />
            </label>
            {current && (
              <form className="cost-review-form" onSubmit={submit}>
                <fieldset disabled={pending.busy || !current.available || !current.checkpoint}>
                  <label>
                    <span>Change</span>
                    <SelectControl
                      aria-label="Exact stock change"
                      value={action}
                      onValueChange={(next) => {
                        setAction(next);
                        setDestination('');
                        setConfirmed(false);
                        setQuantity('');
                        setUnitCost('');
                        setOriginal('');
                        setCredit('');
                        setFree(false);
                      }}
                      options={[
                        { value: 'transfer', label: 'Transfer stock' },
                        { value: 'damage', label: 'Record damaged stock' },
                        { value: 'count', label: 'Record a stock count' },
                        { value: 'supplier_return', label: 'Return to supplier' },
                        { value: 'receipt_reversal', label: 'Reverse an untouched receipt' },
                      ]}
                    />
                  </label>
                  <label>
                    <span>{action === 'transfer' ? 'From' : 'Place'}</span>
                    <SelectControl
                      aria-label="Exact stock place"
                      value={place}
                      onValueChange={(next) => {
                        setPlace(next);
                        setDestination('');
                        setConfirmed(false);
                        setOriginal('');
                      }}
                      options={current.positions.map((p) => ({
                        value: p.locationId,
                        label: `${p.name} · ${p.quantity} ${current.item.unit}`,
                      }))}
                    />
                  </label>
                  {action === 'transfer' && (
                    <label>
                      <span>Destination</span>
                      <SelectControl
                        aria-label="Exact stock destination"
                        required
                        value={destination}
                        onValueChange={setDestination}
                        options={[
                          { value: '', label: 'Choose destination' },
                          ...current.positions
                            .filter((p) => p.locationId !== place)
                            .map((p) => ({ value: p.locationId, label: p.name })),
                        ]}
                      />
                    </label>
                  )}
                  {needsReceipt && (
                    <label>
                      <span>Original purchase</span>
                      <SelectControl
                        aria-label="Exact stock purchase"
                        required
                        value={original}
                        onValueChange={setOriginal}
                        options={[
                          { value: '', label: 'Choose purchase' },
                          ...current.receipts
                            .filter((r) => action === 'supplier_return' || r.locationId === place)
                            .map((r) => ({
                              value: r.id,
                              label: `${r.reference ?? r.id.slice(0, 8)} · ${r.quantity} units · ${r.date}`,
                            })),
                        ]}
                      />
                    </label>
                  )}
                  <label>
                    <span>{action === 'count' ? 'Counted quantity' : 'Change quantity'}</span>
                    <InputControl inputMode="numeric" required value={quantity} onValueChange={setQuantity} />
                  </label>
                  {gain && (
                    <label>
                      <span>Documented unit cost of added stock ({current.currency})</span>
                      <InputControl
                        inputMode="decimal"
                        required
                        value={unitCost}
                        onValueChange={setUnitCost}
                      />
                    </label>
                  )}
                  {gain && /^0+(\.0{1,2})?$/.test(unitCost) && (
                    <label className="pricing-checkbox">
                      <input
                        type="checkbox"
                        required
                        checked={free}
                        onChange={(e) => setFree(e.target.checked)}
                      />
                      The added stock was acquired free of charge.
                    </label>
                  )}
                  {needsReceipt && (
                    <label>
                      <span>Supplier credit amount ({current.currency}, optional)</span>
                      <InputControl inputMode="decimal" value={credit} onValueChange={setCredit} />
                    </label>
                  )}
                  <label>
                    <span>Change date</span>
                    <InputControl required type="date" value={date} onValueChange={setDate} />
                  </label>
                  <label>
                    <span>Stock change reference</span>
                    <InputControl required maxLength={200} value={reference} onValueChange={setReference} />
                  </label>
                  <label>
                    <span>Stock change reason</span>
                    <InputControl required maxLength={200} value={reason} onValueChange={setReason} />
                  </label>
                  <label className="pricing-checkbox">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I checked the quantity and supporting records.
                  </label>
                  <button
                    className="button"
                    type="submit"
                    disabled={!confirmed || !reference.trim() || !reason.trim()}
                  >
                    Review stock change
                  </button>
                </fieldset>
              </form>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
