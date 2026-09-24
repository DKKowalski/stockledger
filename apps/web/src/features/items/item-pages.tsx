import { ArrowUpRight, Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { money } from '../../lib/presentation';

export function AdminItemsPage() {
  return <PageState>
    <PageHeader title="Items" subtitle="Manage the company catalog, costs, prices, and opening stock." />
    <AddItemPanel />
    <SellingPricesPanel />
    <OperationsCatalog />
  </PageState>;
}

export function ManagerItemsPage() {
  return <PageState>
    <PageHeader title="Items" subtitle="The company catalog and stock held at each place." />
    <OperationsCatalog />
  </PageState>;
}

export function ShopCatalogPage() {
  const { snapshot } = useInventoryStore();
  const rows = snapshot?.positions ?? [];
  const shop = snapshot?.locations.find((place) => place.id === snapshot.locationId);
  return <PageState>
    <PageHeader title="Shop catalog" subtitle={`Items available at ${shop?.name ?? 'your assigned shop'}.`} />
    <Panel title={`On the shelf (${rows.length})`}>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th className="num">Selling price</th><th className="num">On hand</th><th>Status</th></tr></thead><tbody>{rows.map((position) => <tr key={position.item.id}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.item.category}</td><td>{position.item.unit}</td><td className="num">{position.item.sellingPriceCents == null ? 'Not set' : money(position.item.sellingPriceCents)}</td><td className="num"><b>{position.closing}</b></td><td>{position.isLowStock ? <span className="badge">low</span> : 'Available'}</td></tr>)}</tbody></table></div> : <EmptyState text="No items are stocked at this shop yet." />}
    </Panel>
  </PageState>;
}

function AddItemPanel() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', sellingPrice: '', openingStock: '0', locationId: '' });
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addItem(accessToken, {
      sku: form.sku, name: form.name, category: form.category || 'General', unit: form.unit || 'pcs',
      reorderLevel: Number(form.reorderLevel), unitCostCents: Math.round(Number(form.unitCost) * 100),
      ...(form.sellingPrice !== '' ? { sellingPriceCents: Math.round(Number(form.sellingPrice) * 100) } : {}),
      openingStock: Number(form.openingStock), locationId: form.locationId,
    }), `${form.name} was added to inventory.`);
    setForm({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', sellingPrice: '', openingStock: '0', locationId: '' });
  };
  return <Panel title="Add item" subtitle="Opening stock lands at the place you choose"><form className="form-grid item-form" onSubmit={(event) => void submit(event).catch(() => {})}>
    {(['sku', 'name', 'category', 'unit'] as const).map((key) => <label key={key}><span>{key === 'sku' ? 'SKU' : key[0].toUpperCase() + key.slice(1)}</span><InputControl required={key === 'sku' || key === 'name'} value={form[key]} onValueChange={(value) => change(key, value)} /></label>)}
    <label><span>Reorder level</span><InputControl type="number" min="0" required value={form.reorderLevel} onValueChange={(value) => change('reorderLevel', value)} /></label>
    <label><span>Unit cost</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(value) => change('unitCost', value)} /></label>
    <label><span>Selling price (optional)</span><InputControl type="number" min="0" max="21474836.47" step="0.01" placeholder="Not set" value={form.sellingPrice} onValueChange={(value) => change('sellingPrice', value)} /></label>
    <label><span>Opening place</span><SelectControl aria-label="Opening place" required value={form.locationId} onValueChange={(value) => change('locationId', value)} options={[{ value: '', label: 'Select place' }, ...(snapshot?.locations.map((place) => ({ value: place.id, label: place.name })) ?? [])]} /></label>
    <label><span>Opening stock</span><InputControl type="number" min="0" required value={form.openingStock} onValueChange={(value) => change('openingStock', value)} /></label>
    <button className="button" disabled={busy || !snapshot?.locations.length}>Add item<ArrowUpRight size={16} /></button>
  </form></Panel>;
}

function SellingPricesPanel() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const catalog = snapshot?.items ?? [];
  const selected = catalog.find((item) => item.id === itemId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selected || price === '') return;
    await mutate(() => api.updateSellingPrice(accessToken, selected.id, Math.round(Number(price) * 100)), `Selling price updated for ${selected.name}.`);
    setItemId('');
    setPrice('');
  };
  return <Panel title="Selling prices" subtitle="One price per item across all shops. Past sales keep their original price." className="spaced"><form className="form-grid place-form" onSubmit={(event) => void submit(event).catch(() => {})}>
    <label><span>Item</span><SelectControl aria-label="Item" required value={itemId} disabled={busy} onValueChange={(value) => { const item = catalog.find((candidate) => candidate.id === value); setItemId(value); setPrice(item?.sellingPriceCents == null ? '' : (item.sellingPriceCents / 100).toFixed(2)); }} options={[{ value: '', label: 'Select item' }, ...catalog.map((item) => ({ value: item.id, label: <>{item.name} · {item.sellingPriceCents == null ? 'Not set' : money(item.sellingPriceCents)}</> }))]} /></label>
    <label><span>Selling price</span><InputControl type="number" min="0" max="21474836.47" step="0.01" required disabled={busy || !selected} value={price} onValueChange={setPrice} /></label>
    <button className="button" disabled={busy || !selected || price === ''}>Save price<Check size={16} /></button>
  </form></Panel>;
}

function OperationsCatalog() {
  const { snapshot } = useInventoryStore();
  const rows = snapshot?.positions ?? [];
  return <Panel title={`Stock by place (${rows.length})`} className="spaced">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th>Category</th><th>Unit</th><th className="num">Reorder</th><th className="num">Cost</th><th className="num">Selling price</th><th className="num">Closing</th><th className="num">Value</th></tr></thead><tbody>{rows.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td>{position.item.category}</td><td>{position.item.unit}</td><td className="num">{position.item.reorderLevel}</td><td className="num">{money(position.item.unitCostCents)}</td><td className="num">{position.item.sellingPriceCents == null ? 'Not set' : money(position.item.sellingPriceCents)}</td><td className="num"><b>{position.closing}</b></td><td className="num">{money(position.valueCents)}</td></tr>)}</tbody></table></div> : <EmptyState text="No items yet." />}</Panel>;
}
