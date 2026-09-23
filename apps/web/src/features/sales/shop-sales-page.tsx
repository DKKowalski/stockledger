import { ArrowUpRight, Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { formatDate, money } from '../../lib/presentation';

export function ShopSalesPage() {
  const { accessToken, user } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const [form, setForm] = useState({ itemId: '', quantity: '' });
  const shop = snapshot?.locations.find((place) => place.id === user?.locationId) ?? snapshot?.locations[0];
  const stocked = snapshot?.positions.filter((position) => position.closing > 0) ?? [];
  const selected = stocked.find((position) => position.item.id === form.itemId);
  const unitPriceCents = selected?.item.sellingPriceCents;
  const totalCents = unitPriceCents == null || !form.quantity ? null : unitPriceCents * Number(form.quantity);
  const sales = snapshot?.movements.filter((movement) => movement.type === 'sale') ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !user?.locationId || !selected || unitPriceCents == null) return;
    const quantity = Number(form.quantity);
    await mutate(() => api.addMovement(accessToken, {
      itemId: selected.item.id, locationId: user.locationId!, type: 'sale', quantity,
      expectedUnitPriceCents: unitPriceCents, movementDate: new Date().toISOString().slice(0, 10),
    }), `Sold ${quantity} ${selected.item.unit} of ${selected.item.name}.`);
    setForm({ itemId: '', quantity: '' });
  };

  return <PageState>
    <PageHeader title="Sell" subtitle={shop ? `A sale reduces stock at ${shop.name} only.` : 'A sale reduces stock at your shop only.'} />
    <Panel title="Record a sale" subtitle="Pick an item that is on the shelf.">
      {stocked.length ? <form className="form-grid sell-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>Item</span><SelectControl aria-label="Item" required value={form.itemId} onChange={(event) => setForm({ itemId: event.target.value, quantity: '' })}><option value="">Select item</option>{stocked.map((position) => <option key={position.item.id} value={position.item.id}>{position.item.name}</option>)}</SelectControl></label>
        <label><span className="label-row"><span>Quantity</span><span className="info-tooltip"><button type="button" aria-label="Stock on hand" aria-describedby="sale-quantity-hint"><Info size={14} /></button><span id="sale-quantity-hint" role="tooltip">{selected ? `${selected.closing} ${selected.item.unit} on hand` : 'Choose an item to see what is on hand'}</span></span></span><input type="number" min="1" max={selected?.closing} required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
        <label><span>Unit price</span><input readOnly value={unitPriceCents == null ? 'Not set' : money(unitPriceCents)} /></label>
        <label><span>Total</span><output className="sale-total" aria-live="polite">{totalCents == null ? '—' : money(totalCents)}</output></label>
        <button className="button" disabled={busy || !selected || unitPriceCents == null}>Sell<ArrowUpRight size={16} /></button>
        {selected && unitPriceCents == null && <p className="price-hint" role="status">Ask an administrator to set a selling price for this item.</p>}
      </form> : <EmptyState text="Nothing to sell yet. Stock arrives when someone transfers it to this shop." />}
    </Panel>
    <Panel title={`Recent sales (${sales.length})`} className="spaced">
      {sales.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td>{formatDate(sale.movementDate)}</td><td><b>{sale.item?.name ?? 'Deleted item'}</b><small>{sale.item?.sku}</small></td><td className="num negative">−{sale.quantity}</td><td className="num">{sale.unitPriceCents == null ? 'Not recorded' : money(sale.unitPriceCents)}</td><td className="num">{sale.saleTotalCents == null ? 'Not recorded' : money(sale.saleTotalCents)}</td></tr>)}</tbody></table></div> : <EmptyState text="No sales recorded at this shop yet." />}
    </Panel>
  </PageState>;
}
