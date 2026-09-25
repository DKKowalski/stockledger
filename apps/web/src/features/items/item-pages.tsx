import { Dialog } from '@base-ui/react/dialog';
import { Archive, Check, Pencil, RotateCcw, Save, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { SpreadsheetImportIcon } from '../../components/animated-icons';
import { InputControl } from '../../components/ui/input-control';
import { AsyncActionButton } from '../../components/ui/async-action-button';
import { useAsyncActionState } from '../../components/ui/use-async-action-state';
import { SpreadsheetImportForm } from './spreadsheet-import-form';
import type { Item } from '../../types';

export function AdminItemsPage() {
  const [searchParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(searchParams.get('import') === '1');
  return <PageState>
    <PageHeader title="Items" subtitle="Manage the company catalog, costs, prices, and opening stock." actions={<button className="button secondary spreadsheet-open-button" onClick={() => setImportOpen((open) => !open)} type="button"><SpreadsheetImportIcon />{importOpen ? 'Close import' : 'Import spreadsheet'}</button>} />
    {importOpen && <SpreadsheetImportPanel onClose={() => setImportOpen(false)} />}
    <AddItemPanel />
    <SellingPricesPanel />
    <CatalogMaintenancePanel />
    <OperationsCatalog />
  </PageState>;
}

function SpreadsheetImportPanel({ onClose }: { onClose: () => void }) {
  const { money } = useCompanySettings();
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  return <Panel title="Import inventory" subtitle="Upload Excel or CSV. StockLedger validates every row before saving anything." className="spreadsheet-import-panel">
    <button aria-label="Close spreadsheet import" className="spreadsheet-import-close" onClick={onClose} type="button"><X size={16} /></button>
    <SpreadsheetImportForm busy={busy} formatMoney={money} locations={snapshot?.locations ?? []} onImport={(locationId, rows) => {
      if (!accessToken) return Promise.reject(new Error('Your session has expired'));
      return mutate(
        () => api.importItems(accessToken, { locationId, rows }),
        `${rows.length} ${rows.length === 1 ? 'item was' : 'items were'} imported.`,
      );
    }} />
  </Panel>;
}

export function ManagerItemsPage() {
  return <PageState>
    <PageHeader title="Items" subtitle="The company catalog and stock held at each place." />
    <OperationsCatalog />
  </PageState>;
}

export function ShopCatalogPage() {
  const { snapshot } = useInventoryStore();
  const { money } = useCompanySettings();
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
  const addAction = useAsyncActionState();
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', sellingPrice: '', openingStock: '0', locationId: '' });
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await addAction.run(() => mutate(() => api.addItem(accessToken, {
      ...(form.sku.trim() ? { sku: form.sku } : {}), name: form.name, category: form.category || 'General', unit: form.unit || 'pcs',
      reorderLevel: Number(form.reorderLevel), unitCostCents: Math.round(Number(form.unitCost) * 100),
      ...(form.sellingPrice !== '' ? { sellingPriceCents: Math.round(Number(form.sellingPrice) * 100) } : {}),
      openingStock: Number(form.openingStock), locationId: form.locationId,
    }), `${form.name} was added to inventory.`));
    setForm({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', sellingPrice: '', openingStock: '0', locationId: '' });
  };
  return <Panel title="Add item" subtitle="Opening stock lands at the place you choose"><form className="form-grid item-form" onSubmit={(event) => void submit(event).catch(() => {})}>
    {(['sku', 'name', 'category', 'unit'] as const).map((key) => <label key={key}><span>{key === 'sku' ? 'Item code (optional)' : key[0].toUpperCase() + key.slice(1)}</span><InputControl placeholder={key === 'sku' ? 'Created automatically' : undefined} required={key === 'name'} value={form[key]} onValueChange={(value) => change(key, value)} /></label>)}
    <label><span>Reorder level</span><InputControl type="number" min="0" required value={form.reorderLevel} onValueChange={(value) => change('reorderLevel', value)} /></label>
    <label><span>Unit cost</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(value) => change('unitCost', value)} /></label>
    <label><span>Selling price (optional)</span><InputControl type="number" min="0" max="21474836.47" step="0.01" placeholder="Not set" value={form.sellingPrice} onValueChange={(value) => change('sellingPrice', value)} /></label>
    <label><span>Opening place</span><SelectControl aria-label="Opening place" required value={form.locationId} onValueChange={(value) => change('locationId', value)} options={[{ value: '', label: 'Select place' }, ...(snapshot?.locations.map((place) => ({ value: place.id, label: place.name })) ?? [])]} /></label>
    <label><span>Opening stock</span><InputControl type="number" min="0" required value={form.openingStock} onValueChange={(value) => change('openingStock', value)} /></label>
    <AsyncActionButton disabled={busy || !snapshot?.locations.length} idleLabel="Add item" pendingLabel="Adding" state={addAction.state} successLabel="Item added" />
  </form></Panel>;
}

function SellingPricesPanel() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { money } = useCompanySettings();
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const catalog = snapshot?.items.filter((item) => item.isActive) ?? [];
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

type ItemForm = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: string;
  unitCost: string;
  sellingPrice: string;
};

function itemForm(item: Item): ItemForm {
  return {
    sku: item.sku,
    name: item.name,
    category: item.category,
    unit: item.unit,
    reorderLevel: String(item.reorderLevel),
    unitCost: (item.unitCostCents / 100).toFixed(2),
    sellingPrice: item.sellingPriceCents == null ? '' : (item.sellingPriceCents / 100).toFixed(2),
  };
}

function CatalogMaintenancePanel() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { money } = useCompanySettings();
  const [selected, setSelected] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemForm | null>(null);
  const catalog = snapshot?.items ?? [];

  const openEditor = (item: Item) => {
    setSelected(item);
    setForm(itemForm(item));
  };

  const closeEditor = () => {
    setSelected(null);
    setForm(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selected || !form) return;
    await mutate(() => api.updateItem(accessToken, selected.id, {
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      unit: form.unit.trim(),
      reorderLevel: Number(form.reorderLevel),
      unitCostCents: Math.round(Number(form.unitCost) * 100),
      ...(form.sellingPrice !== '' ? { sellingPriceCents: Math.round(Number(form.sellingPrice) * 100) } : {}),
    }), `${form.name} was updated.`);
    closeEditor();
  };

  const toggleActive = async (item: Item) => {
    if (!accessToken) return;
    try {
      await mutate(
        () => api.updateItem(accessToken, item.id, { isActive: !item.isActive }),
        item.isActive ? `${item.name} was archived.` : `${item.name} was restored.`,
      );
      if (selected?.id === item.id) closeEditor();
    } catch (caught) {
      toast.error(item.isActive ? 'Could not archive item' : 'Could not restore item', {
        description: caught instanceof Error ? caught.message : 'Try again.',
      });
    }
  };

  const change = (key: keyof ItemForm, value: string) => setForm((current) => current ? { ...current, [key]: value } : current);

  return <>
    <Panel title={`Catalog maintenance (${catalog.length})`} subtitle="Edit item details or archive products you no longer stock." className="spaced">
      {catalog.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th className="num">Cost</th><th className="num">Price</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{catalog.map((item) => <tr className={item.isActive ? '' : 'inactive-account-row'} key={item.id}><td><b>{item.name}</b><small>{item.sku}</small></td><td>{item.category}</td><td>{item.unit}</td><td className="num">{money(item.unitCostCents)}</td><td className="num">{item.sellingPriceCents == null ? 'Not set' : money(item.sellingPriceCents)}</td><td><span className={`account-status ${item.isActive ? 'active' : 'inactive'}`}><i />{item.isActive ? 'Active' : 'Archived'}</span></td><td className="catalog-actions"><button className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => openEditor(item)} type="button"><Pencil size={15} /></button><button className="icon-button" aria-label={`${item.isActive ? 'Archive' : 'Restore'} ${item.name}`} disabled={busy} onClick={() => void toggleActive(item)} type="button">{item.isActive ? <Archive size={15} /> : <RotateCcw size={15} />}</button></td></tr>)}</tbody></table></div> : <EmptyState text="No catalog items yet." />}
    </Panel>
    <Dialog.Root open={Boolean(selected && form)} onOpenChange={(open) => { if (!open) closeEditor(); }}>
      {selected && form && <Dialog.Portal>
        <Dialog.Backdrop className="team-share-backdrop" />
        <Dialog.Viewport className="team-share-viewport">
          <Dialog.Popup className="team-share-dialog item-edit-dialog">
            <div className="team-share-heading"><div><Dialog.Title>Edit item</Dialog.Title><Dialog.Description>Changes apply everywhere this item is stocked.</Dialog.Description></div><Dialog.Close className="team-share-dismiss" aria-label="Close item editor"><X size={17} /></Dialog.Close></div>
            <form className="form-grid item-edit-form" onSubmit={(event) => void submit(event).catch(() => {})}>
              <label><span>Item code</span><InputControl required maxLength={80} value={form.sku} onValueChange={(value) => change('sku', value)} /></label>
              <label><span>Name</span><InputControl required maxLength={160} value={form.name} onValueChange={(value) => change('name', value)} /></label>
              <label><span>Category</span><InputControl required maxLength={100} value={form.category} onValueChange={(value) => change('category', value)} /></label>
              <label><span>Unit</span><InputControl required maxLength={40} value={form.unit} onValueChange={(value) => change('unit', value)} /></label>
              <label><span>Reorder level</span><InputControl type="number" min="0" required value={form.reorderLevel} onValueChange={(value) => change('reorderLevel', value)} /></label>
              <label><span>Unit cost</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(value) => change('unitCost', value)} /></label>
              <label><span>Selling price</span><InputControl type="number" min="0" step="0.01" value={form.sellingPrice} onValueChange={(value) => change('sellingPrice', value)} /></label>
              <div className="item-edit-actions"><button className="button secondary" onClick={() => void toggleActive(selected)} type="button">{selected.isActive ? <><Archive size={15} />Archive</> : <><RotateCcw size={15} />Restore</>}</button><button className="button" disabled={busy}><Save size={15} />Save changes</button></div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>}
    </Dialog.Root>
  </>;
}

function OperationsCatalog() {
  const { snapshot } = useInventoryStore();
  const { money } = useCompanySettings();
  const rows = snapshot?.positions ?? [];
  return <Panel title={`Stock by place (${rows.length})`} className="spaced">{rows.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th>Category</th><th>Unit</th><th className="num">Reorder</th><th className="num">Cost</th><th className="num">Selling price</th><th className="num">Closing</th><th className="num">Value</th></tr></thead><tbody>{rows.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td>{position.item.category}</td><td>{position.item.unit}</td><td className="num">{position.item.reorderLevel}</td><td className="num">{money(position.item.unitCostCents)}</td><td className="num">{position.item.sellingPriceCents == null ? 'Not set' : money(position.item.sellingPriceCents)}</td><td className="num"><b>{position.closing}</b></td><td className="num">{money(position.valueCents)}</td></tr>)}</tbody></table></div> : <EmptyState text="No items yet." />}</Panel>;
}
