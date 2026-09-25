import { ArrowUpRight, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InfoTooltip } from '../../components/ui/info-tooltip';
import { InputControl } from '../../components/ui/input-control';
import { movementMeta } from '../../lib/presentation';
import type { MovementType, Supplier } from '../../types';

export function MovementsPage() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { money, calendarDate } = useCompanySettings();
  const [filter, setFilter] = useState<'all' | MovementType>('all');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState({
    itemId: '',
    locationId: '',
    destinationLocationId: '',
    type: 'purchase' as MovementType,
    quantity: '',
    movementDate: new Date().toISOString().slice(0, 10),
    reference: '',
    note: '',
    unitCost: '',
    supplierId: '',
    relatedMovementId: '',
  });
  const items = snapshot?.items.filter((item) => item.isActive) ?? [];
  const places = snapshot?.locations ?? [];
  const rows = snapshot?.movements.filter((movement) => filter === 'all' || movement.type === filter) ?? [];
  const returnedBySale = new Map<string, number>();
  for (const movement of snapshot?.movements ?? []) {
    if (movement.type === 'return_in' && movement.relatedMovementId) {
      returnedBySale.set(movement.relatedMovementId, (returnedBySale.get(movement.relatedMovementId) ?? 0) + movement.quantity);
    }
  }
  const sales = snapshot?.movements.filter((movement) => movement.type === 'sale' && (returnedBySale.get(movement.id) ?? 0) < movement.quantity) ?? [];
  const selectedSale = sales.find((sale) => sale.id === form.relatedMovementId);
  const returnableQuantity = selectedSale ? selectedSale.quantity - (returnedBySale.get(selectedSale.id) ?? 0) : undefined;

  useEffect(() => {
    if (!accessToken) return;
    void api.suppliers(accessToken).then(setSuppliers).catch(() => toast.error('Could not load suppliers'));
  }, [accessToken]);

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
      unitCostCents: form.type === 'purchase' ? Math.round(Number(form.unitCost) * 100) : undefined,
      supplierId: form.type === 'purchase' && form.supplierId ? form.supplierId : undefined,
      relatedMovementId: form.type === 'return_in' ? form.relatedMovementId : undefined,
    }), `${movementMeta[form.type].label} was recorded.`);
    setForm((current) => ({ ...current, quantity: '', reference: '', note: '', unitCost: '', relatedMovementId: '' }));
  };

  return <PageState>
    <PageHeader title="Stock movements" subtitle="Receive, transfer, return, or write off inventory." actions={<><NavLink className="button secondary" to="/stock-counts">Count stock</NavLink><NavLink className="button secondary" to="/suppliers">Suppliers</NavLink></>} />
    <Panel title="Record movement" subtitle="The ledger updates the affected balances immediately.">
      <form className="form-grid movement-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>Item</span><SelectControl aria-label="Item" required value={form.itemId} disabled={form.type === 'return_in'} onValueChange={(itemId) => setForm({ ...form, itemId })} options={[{ value: '', label: 'Select item' }, ...items.map((item) => ({ value: item.id, label: item.name }))]} /></label>
        <label><span className="label-row"><span>Movement type</span><InfoTooltip label="About movement type">{movementMeta[form.type].hint}</InfoTooltip></span><SelectControl aria-label="Movement type" value={form.type} onValueChange={(value) => setForm({ ...form, type: value as MovementType, destinationLocationId: '', relatedMovementId: '', itemId: value === 'return_in' ? '' : form.itemId, locationId: value === 'return_in' ? '' : form.locationId })} options={(Object.entries(movementMeta) as [MovementType, { label: string; hint: string }][]).filter(([value]) => value !== 'sale' && value !== 'adjustment_in' && value !== 'adjustment_out').map(([value, meta]) => ({ value, label: meta.label }))} /></label>
        {form.type === 'return_in' && <label><span>Original sale</span><SelectControl aria-label="Original sale" required value={form.relatedMovementId} onValueChange={(relatedMovementId) => { const sale = sales.find((candidate) => candidate.id === relatedMovementId); setForm({ ...form, relatedMovementId, itemId: sale?.itemId ?? '', locationId: sale?.locationId ?? '', quantity: '' }); }} options={[{ value: '', label: 'Select sale' }, ...sales.map((sale) => ({ value: sale.id, label: `${sale.item?.name ?? 'Deleted item'} · ${sale.quantity - (returnedBySale.get(sale.id) ?? 0)} returnable · ${sale.movementDate}` }))]} /></label>}
        <label><span>{form.type === 'transfer' ? 'From' : 'Place'}</span><SelectControl aria-label={form.type === 'transfer' ? 'From' : 'Place'} required value={form.locationId} disabled={form.type === 'return_in'} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select place' }, ...places.map((place) => ({ value: place.id, label: place.name }))]} /></label>
        {form.type === 'transfer' && <label><span>To</span><SelectControl aria-label="To" required value={form.destinationLocationId} onValueChange={(destinationLocationId) => setForm({ ...form, destinationLocationId })} options={[{ value: '', label: 'Select place' }, ...places.filter((place) => place.id !== form.locationId).map((place) => ({ value: place.id, label: place.name }))]} /></label>}
        <label><span>Quantity</span><InputControl type="number" min="1" max={returnableQuantity} required value={form.quantity} onValueChange={(quantity) => setForm({ ...form, quantity })} /></label>
        {form.type === 'purchase' && <label><span>Unit cost</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(unitCost) => setForm({ ...form, unitCost })} /></label>}
        {form.type === 'purchase' && <label><span>Supplier</span><SelectControl aria-label="Supplier" value={form.supplierId} onValueChange={(supplierId) => setForm({ ...form, supplierId })} options={[{ value: '', label: 'No supplier' }, ...suppliers.filter((supplier) => supplier.isActive).map((supplier) => ({ value: supplier.id, label: supplier.name }))]} /></label>}
        <label><span>Date</span><InputControl type="date" required value={form.movementDate} onValueChange={(movementDate) => setForm({ ...form, movementDate })} /></label>
        <label><span>Reference</span><InputControl value={form.reference} onValueChange={(reference) => setForm({ ...form, reference })} /></label>
        <label><span>Note</span><InputControl value={form.note} onValueChange={(note) => setForm({ ...form, note })} /></label>
        <button className="button" disabled={busy || !items.length}>Save movement<ArrowUpRight size={16} /></button>
      </form>
    </Panel>
    <Panel title={`Movement ledger (${rows.length})`} className="spaced">
      <div className="filter-row"><label><span className="sr-only">Filter movement type</span><SelectControl aria-label="Filter movement type" value={filter} onValueChange={(value) => setFilter(value as typeof filter)} options={[{ value: 'all', label: 'All movement types' }, ...Object.entries(movementMeta).map(([value, meta]) => ({ value, label: meta.label }))]} /></label></div>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Place</th><th>Reference</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Sale total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((movement) => <tr key={movement.id}><td>{calendarDate(movement.movementDate)}</td><td><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movement.note}</small></td><td>{movementMeta[movement.type].label}</td><td>{movement.destination ? `${movement.location?.name ?? 'Unknown'} → ${movement.destination.name}` : movement.location?.name ?? 'Unknown'}</td><td>{movement.reference || suppliers.find((supplier) => supplier.id === movement.supplierId)?.name || '—'}</td><td className={`num ${movement.sign === 1 ? 'positive' : 'negative'}`}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</td><td className="num">{movement.unitCostCents == null ? '—' : money(movement.unitCostCents)}</td><td className="num">{movement.saleTotalCents == null ? '—' : money(movement.saleTotalCents)}</td><td className="num">{movement.stockCountId ? <span className="account-owner-label">Counted</span> : <button className="icon-button" aria-label="Delete movement" disabled={busy} onClick={() => accessToken && void mutate(() => api.deleteMovement(accessToken, movement.id), 'The stock movement was removed.')}><Trash2 size={16} /></button>}</td></tr>)}</tbody></table></div> : <EmptyState text="No movements match this filter." />}
    </Panel>
  </PageState>;
}
