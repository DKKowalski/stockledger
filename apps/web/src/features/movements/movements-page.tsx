import { ArrowUpRight, Info, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { formatDate, money, movementMeta } from '../../lib/presentation';
import type { MovementType } from '../../types';

export function MovementsPage() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const [filter, setFilter] = useState<'all' | MovementType>('all');
  const [form, setForm] = useState({
    itemId: '',
    locationId: '',
    destinationLocationId: '',
    type: 'purchase' as MovementType,
    quantity: '',
    movementDate: new Date().toISOString().slice(0, 10),
    reference: '',
    note: '',
  });
  const items = snapshot?.items ?? [];
  const places = snapshot?.locations ?? [];
  const rows = snapshot?.movements.filter((movement) => filter === 'all' || movement.type === filter) ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addMovement(accessToken, {
      itemId: form.itemId,
      locationId: form.locationId,
      destinationLocationId: form.type === 'transfer' ? form.destinationLocationId : undefined,
      type: form.type,
      quantity: Number(form.quantity),
      movementDate: form.movementDate,
      reference: form.reference,
      note: form.note,
    }), `${movementMeta[form.type].label} was recorded.`);
    setForm((current) => ({ ...current, quantity: '', reference: '', note: '' }));
  };

  return <PageState>
    <PageHeader title="Stock movements" subtitle="Receive, transfer, return, or write off inventory." />
    <Panel title="Record movement" subtitle="The ledger updates the affected balances immediately.">
      <form className="form-grid movement-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>Item</span><SelectControl required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl></label>
        <label><span className="label-row"><span>Movement type</span><span className="info-tooltip"><button type="button" aria-label="About movement type" aria-describedby="movement-type-hint"><Info size={14} /></button><span id="movement-type-hint" role="tooltip">{movementMeta[form.type].hint}</span></span></span><SelectControl value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MovementType, destinationLocationId: '' })}>{(Object.entries(movementMeta) as [MovementType, { label: string; hint: string }][]).filter(([value]) => value !== 'sale').map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</SelectControl></label>
        <label><span>{form.type === 'transfer' ? 'From' : 'Place'}</span><SelectControl required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">Select place</option>{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</SelectControl></label>
        {form.type === 'transfer' && <label><span>To</span><SelectControl required value={form.destinationLocationId} onChange={(event) => setForm({ ...form, destinationLocationId: event.target.value })}><option value="">Select place</option>{places.filter((place) => place.id !== form.locationId).map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</SelectControl></label>}
        <label><span>Quantity</span><input type="number" min="1" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
        <label><span>Date</span><input type="date" required value={form.movementDate} onChange={(event) => setForm({ ...form, movementDate: event.target.value })} /></label>
        <label><span>Reference</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
        <label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        <button className="button" disabled={busy || !items.length}>Save movement<ArrowUpRight size={16} /></button>
      </form>
    </Panel>
    <Panel title={`Movement ledger (${rows.length})`} className="spaced">
      <div className="filter-row"><label><span className="sr-only">Filter movement type</span><SelectControl value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All movement types</option>{Object.entries(movementMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</SelectControl></label></div>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Place</th><th>Reference</th><th className="num">Qty</th><th className="num">Sale price</th><th className="num">Sale total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((movement) => <tr key={movement.id}><td>{formatDate(movement.movementDate)}</td><td><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movement.note}</small></td><td>{movementMeta[movement.type].label}</td><td>{movement.destination ? `${movement.location?.name ?? 'Unknown'} → ${movement.destination.name}` : movement.location?.name ?? 'Unknown'}</td><td>{movement.reference || '—'}</td><td className={`num ${movement.sign === 1 ? 'positive' : 'negative'}`}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</td><td className="num">{movement.type !== 'sale' ? '—' : movement.unitPriceCents == null ? 'Not recorded' : money(movement.unitPriceCents)}</td><td className="num">{movement.type !== 'sale' ? '—' : movement.saleTotalCents == null ? 'Not recorded' : money(movement.saleTotalCents)}</td><td className="num"><button className="icon-button" aria-label="Delete movement" disabled={busy} onClick={() => accessToken && void mutate(() => api.deleteMovement(accessToken, movement.id), 'The stock movement was removed.')}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div> : <EmptyState text="No movements match this filter." />}
    </Panel>
  </PageState>;
}
