import { Dialog } from '@base-ui/react/dialog';
import { Save, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { AsyncActionButton } from '../../components/ui/async-action-button';
import { useAsyncActionState } from '../../components/ui/use-async-action-state';
import { SpreadsheetImportForm } from './spreadsheet-import-form';
import type { Item } from '../../types';

export function SpreadsheetImportPanel({ onClose }: { onClose: () => void }) {
  const { money, settings, terms } = useCompanySettings();
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  return <Panel title="Import inventory" subtitle="Upload Excel or CSV. StockLedger validates every row before saving anything." className="spreadsheet-import-panel">
    <button aria-label="Close spreadsheet import" className="spreadsheet-import-close" onClick={onClose} type="button"><X size={16} /></button>
    <SpreadsheetImportForm busy={busy} defaultLocationId={settings?.defaultLocationId} formatMoney={money} locations={snapshot?.locations ?? []} onImport={(locationId, rows, fileName) => {
      if (!accessToken) return Promise.reject(new Error('Your session has expired'));
      return mutate(
        () => api.importItems(accessToken, { locationId, rows, fileName }),
        `${rows.length} ${rows.length === 1 ? `${terms.item} was` : `${terms.items} were`} imported.`,
      );
    }} />
  </Panel>;
}

export function ManagerItemsPage() {
  const { terms } = useCompanySettings();
  return <PageState>
    <PageHeader title={terms.Items} />
    <OperationsCatalog />
  </PageState>;
}

export function ShopCatalogPage() {
  const { snapshot } = useInventoryStore();
  const { money, terms } = useCompanySettings();
  const rows = snapshot?.positions ?? [];
  const shop = snapshot?.locations.find((place) => place.id === snapshot.locationId);
  return <PageState>
    <PageHeader title={`${terms.Shop} catalog`} subtitle={`${terms.Items} available at ${shop?.name ?? `your assigned ${terms.shop}`}.`} />
    <Panel title={`On the shelf (${rows.length})`}>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>{terms.Item}</th><th>Category</th><th>Unit</th><th className="num">Selling price</th><th className="num">On hand</th><th>Status</th></tr></thead><tbody>{rows.map((position) => <tr key={position.item.id}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.item.category}</td><td>{position.item.unit}</td><td className="num">{position.item.sellingPriceCents == null ? 'Not set' : money(position.item.sellingPriceCents)}</td><td className="num"><b>{position.closing}</b></td><td>{position.isLowStock ? <span className="badge">low</span> : 'Available'}</td></tr>)}</tbody></table></div> : <EmptyState text={`No ${terms.items} are stocked at this ${terms.shop} yet.`} />}
    </Panel>
  </PageState>;
}

export function AddItemPanel({ onClose }: { onClose: () => void }) {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const { settings, terms } = useCompanySettings();
  const addAction = useAsyncActionState();
  const defaults = () => ({ sku: '', name: '', category: '', unit: settings?.defaultUnit ?? 'pcs', reorderLevel: String(settings?.defaultReorderLevel ?? 10), unitCost: '0', sellingPrice: '', openingStock: '0', locationId: settings?.defaultLocationId ?? '' });
  const [form, setForm] = useState(defaults);
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await addAction.run(() => mutate(() => api.addItem(accessToken, {
      ...(form.sku.trim() ? { sku: form.sku } : {}), name: form.name, category: form.category || 'General', unit: form.unit,
      reorderLevel: Number(form.reorderLevel), unitCostCents: Math.round(Number(form.unitCost) * 100),
      ...(form.sellingPrice !== '' ? { sellingPriceCents: Math.round(Number(form.sellingPrice) * 100) } : {}),
      openingStock: Number(form.openingStock), locationId: form.locationId,
    }), `${form.name} was added to inventory.`));
    setForm(defaults());
  };
  return <Panel title={`Add ${terms.item}`} className="add-item-panel">
    <button aria-label={`Close add ${terms.item}`} className="panel-close" onClick={onClose} type="button"><X size={16} /></button>
    <form className="form-grid item-form" onSubmit={(event) => void submit(event).catch(() => {})}>
    {(['sku', 'name', 'category', 'unit'] as const).map((key) => <label key={key}><span>{key === 'sku' ? `${terms.Item} code (optional)` : key[0].toUpperCase() + key.slice(1)}</span><InputControl placeholder={key === 'sku' ? 'Created automatically' : undefined} required={key === 'name' || key === 'unit'} value={form[key]} onValueChange={(value) => change(key, value)} /></label>)}
    <label><span>Reorder level</span><InputControl type="number" min="0" required value={form.reorderLevel} onValueChange={(value) => change('reorderLevel', value)} /></label>
    <label><span>Unit cost</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(value) => change('unitCost', value)} /></label>
    <label><span>Selling price (optional)</span><InputControl type="number" min="0" max="21474836.47" step="0.01" placeholder="Not set" value={form.sellingPrice} onValueChange={(value) => change('sellingPrice', value)} /></label>
    <label><span>Opening place</span><SelectControl aria-label="Opening place" required value={form.locationId} onValueChange={(value) => change('locationId', value)} options={[{ value: '', label: 'Select place' }, ...(snapshot?.locations.map((place) => ({ value: place.id, label: place.name })) ?? [])]} /></label>
    <label><span>Opening stock</span><InputControl type="number" min="0" required value={form.openingStock} onValueChange={(value) => change('openingStock', value)} /></label>
    <AsyncActionButton disabled={busy || !snapshot?.locations.length} idleLabel={`Add ${terms.item}`} pendingLabel="Adding" state={addAction.state} successLabel={`${terms.Item} added`} />
  </form>
  </Panel>;
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

/** Edits an item's catalog details; archiving lives beside it in the item panel. */
export function ItemEditDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { accessToken } = useAuth();
  const { mutate, busy } = useInventoryStore();
  const { terms } = useCompanySettings();
  const [form, setForm] = useState<ItemForm>(() => itemForm(item));
  const change = (key: keyof ItemForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.updateItem(accessToken, item.id, {
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      unit: form.unit.trim(),
      reorderLevel: Number(form.reorderLevel),
      unitCostCents: Math.round(Number(form.unitCost) * 100),
      ...(form.sellingPrice !== '' ? { sellingPriceCents: Math.round(Number(form.sellingPrice) * 100) } : {}),
    }), `${form.name} was updated.`);
    onClose();
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="team-share-backdrop" />
      <Dialog.Viewport className="team-share-viewport">
        <Dialog.Popup className="team-share-dialog item-edit-dialog">
          <div className="team-share-heading"><div><Dialog.Title>Edit {terms.item}</Dialog.Title><Dialog.Description>Changes apply everywhere this {terms.item} is stocked.</Dialog.Description></div><Dialog.Close className="team-share-dismiss" aria-label={`Close ${terms.item} editor`}><X size={17} /></Dialog.Close></div>
          <form className="form-grid item-edit-form" onSubmit={(event) => void submit(event).catch(() => {})}>
            <label><span>{terms.Item} code</span><InputControl required maxLength={80} value={form.sku} onValueChange={(value) => change('sku', value)} /></label>
            <label><span>Name</span><InputControl required maxLength={160} value={form.name} onValueChange={(value) => change('name', value)} /></label>
            <label><span>Category</span><InputControl required maxLength={100} value={form.category} onValueChange={(value) => change('category', value)} /></label>
            <label><span>Unit</span><InputControl required maxLength={40} value={form.unit} onValueChange={(value) => change('unit', value)} /></label>
            <label><span>Reorder level</span><InputControl type="number" min="0" required value={form.reorderLevel} onValueChange={(value) => change('reorderLevel', value)} /></label>
            <label><span>Unit cost</span><InputControl type="number" min="0" step="0.01" required value={form.unitCost} onValueChange={(value) => change('unitCost', value)} /></label>
            <label><span>Selling price</span><InputControl type="number" min="0" step="0.01" value={form.sellingPrice} onValueChange={(value) => change('sellingPrice', value)} /></label>
            <div className="item-edit-actions"><button className="button" disabled={busy}><Save size={15} />Save changes</button></div>
          </form>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}

function OperationsCatalog() {
  const { snapshot } = useInventoryStore();
  const { money, terms } = useCompanySettings();
  const rows = snapshot?.positions ?? [];
  return <Panel title={`Stock by place (${rows.length})`} className="spaced">{rows.length ? <div className="table-wrap"><table><thead><tr><th>{terms.Item}</th><th>Place</th><th>Category</th><th>Unit</th><th className="num">Reorder</th><th className="num">Cost</th><th className="num">Selling price</th><th className="num">Closing</th><th className="num">Value</th></tr></thead><tbody>{rows.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td>{position.item.category}</td><td>{position.item.unit}</td><td className="num">{position.item.reorderLevel}</td><td className="num">{money(position.item.unitCostCents)}</td><td className="num">{position.item.sellingPriceCents == null ? 'Not set' : money(position.item.sellingPriceCents)}</td><td className="num"><b>{position.closing}</b></td><td className="num">{money(position.valueCents)}</td></tr>)}</tbody></table></div> : <EmptyState text={`No ${terms.items} yet.`} />}</Panel>;
}
