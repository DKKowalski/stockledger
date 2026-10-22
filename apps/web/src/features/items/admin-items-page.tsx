import { Archive, Check, Info, Pencil, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState } from '../../components/inventory-ui';
import { SpreadsheetImportIcon } from '../../components/animated-icons';
import { InputControl } from '../../components/ui/input-control';
import { movementMeta } from '../../lib/presentation';
import type { Item, Movement, Position } from '../../types';
import { ExactCostPanel } from './exact-cost-panel';
import { usePricingPreviewAvailable, useToggleItemActive } from './item-hooks';
import { AddItemPanel, ItemEditDialog, SpreadsheetImportPanel } from './item-pages';
import { PricingEditor } from './pricing-preview-panel';

type CatalogFilter = 'all' | 'low' | 'unpriced' | 'archived';
type ItemTab = 'stock' | 'pricing' | 'history';

type CatalogRow = {
  item: Item;
  positions: Position[];
  onHand: number;
  isLow: boolean;
};

// Category tiles cycle through the palette so neighbouring categories read apart.
const TILE_TONES = ['tone-lime', 'tone-violet', 'tone-sky', 'tone-coral', 'tone-sand'] as const;

function initials(name: string) {
  return name.split(/\s+/).filter((word) => /^\p{L}/u.test(word)).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}

export function AdminItemsPage() {
  const { snapshot } = useInventoryStore();
  const { settings, terms } = useCompanySettings();
  const [searchParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(searchParams.get('import') === '1');
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const catalog = useMemo<CatalogRow[]>(() => (snapshot?.items ?? []).map((item) => {
    const positions = (snapshot?.positions ?? []).filter((position) => position.item.id === item.id);
    return {
      item,
      positions,
      onHand: positions.reduce((total, position) => total + position.closing, 0),
      isLow: positions.some((position) => position.isLowStock),
    };
  }).sort((left, right) => left.item.name.localeCompare(right.item.name)), [snapshot]);

  const active = catalog.filter((row) => row.item.isActive);
  const counts = {
    all: active.length,
    low: active.filter((row) => row.isLow).length,
    unpriced: active.filter((row) => row.item.sellingPriceCents == null).length,
    archived: catalog.length - active.length,
  };
  const categories = [...new Set(active.map((row) => row.item.category))].sort();
  const search = query.trim().toLowerCase();
  const rows = catalog.filter((row) => (filter === 'archived' ? !row.item.isActive : row.item.isActive)
    && (filter !== 'low' || row.isLow)
    && (filter !== 'unpriced' || row.item.sellingPriceCents == null)
    && (!category || row.item.category === category)
    && (!search || row.item.name.toLowerCase().includes(search) || row.item.sku.toLowerCase().includes(search)));
  const selected = rows.find((row) => row.item.id === selectedId) ?? rows[0] ?? null;
  const mostHeld = Math.max(1, ...rows.map((row) => row.onHand));
  const placeCount = snapshot?.locations.length ?? 0;

  const select = (id: string) => {
    setSelectedId(id);
    // On narrow screens the panel sits under the list, so bring it into view.
    if (window.matchMedia('(max-width: 1100px)').matches) {
      window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const filters: Array<{ key: CatalogFilter; label: string; tone: string }> = [
    { key: 'all', label: `All ${terms.items}`, tone: 'tone-plain' },
    { key: 'low', label: 'Low stock', tone: 'tone-coral' },
    { key: 'unpriced', label: 'No selling price yet', tone: 'tone-lime' },
    { key: 'archived', label: 'Archived', tone: 'tone-violet' },
  ];

  return <PageState>
    <PageHeader
      title={terms.Items}
      accent={`${counts.all} ${counts.all === 1 ? terms.item : terms.items}, ${placeCount} ${placeCount === 1 ? 'place' : 'places'}`}
      actions={<>
        <button className="button secondary spreadsheet-open-button" aria-expanded={importOpen} onClick={() => setImportOpen((open) => !open)} type="button"><SpreadsheetImportIcon />{importOpen ? 'Close import' : 'Import spreadsheet'}</button>
        <button className="button" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)} type="button">{addOpen ? <>Close<X size={16} /></> : <>Add {terms.item}<Plus size={16} /></>}</button>
      </>}
    />
    {importOpen && <SpreadsheetImportPanel onClose={() => setImportOpen(false)} />}
    {addOpen && <AddItemPanel key={`${settings?.defaultUnit}:${settings?.defaultReorderLevel}:${settings?.defaultLocationId}`} onClose={() => setAddOpen(false)} />}

    <div className="catalog-filters" role="group" aria-label="Quick filters">
      {filters.map((option) => <button
        aria-pressed={filter === option.key}
        className={`catalog-filter ${option.tone} ${filter === option.key ? 'is-active' : ''}`}
        key={option.key}
        onClick={() => { setFilter(option.key); setSelectedId(null); }}
        type="button"
      ><span>{option.label}</span><strong>{counts[option.key]}</strong></button>)}
    </div>

    <div className="catalog-layout">
      <section className="catalog-list" aria-label={`${terms.Item} catalog`}>
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search {terms.items}</span>
            <input placeholder={`Search by name or ${terms.item} code`} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {categories.length > 1 && <div className="catalog-categories" role="group" aria-label="Category">
            <button aria-pressed={!category} className={!category ? 'is-active' : ''} onClick={() => setCategory('')} type="button">All categories</button>
            {categories.map((name) => <button aria-pressed={category === name} className={category === name ? 'is-active' : ''} key={name} onClick={() => setCategory(name)} type="button">{name}</button>)}
          </div>}
        </div>
        <div className="catalog-columns" aria-hidden="true"><span>{terms.Item}</span><span>Stock</span><span>Selling price</span></div>
        {rows.length ? rows.map((row) => <CatalogRowButton
          key={row.item.id}
          row={row}
          selected={row.item.id === selected?.item.id}
          tone={TILE_TONES.at(categories.indexOf(row.item.category) % TILE_TONES.length) ?? 'tone-sand'}
          share={row.onHand / mostHeld}
          onSelect={() => select(row.item.id)}
        />) : <EmptyState text={catalog.length ? `No ${terms.items} match these filters.` : `No ${terms.items} yet. Add one or import a spreadsheet.`} />}
      </section>

      {selected && <aside className="item-panel" ref={panelRef} aria-label={`${selected.item.name} details`}>
        <ItemPanel key={selected.item.id} row={selected} tone={TILE_TONES.at(categories.indexOf(selected.item.category) % TILE_TONES.length) ?? 'tone-sand'} />
      </aside>}
    </div>
    <ExactCostPanel />
  </PageState>;
}

function CatalogRowButton({ row, selected, tone, share, onSelect }: { row: CatalogRow; selected: boolean; tone: string; share: number; onSelect: () => void }) {
  const { money } = useCompanySettings();
  const places = row.positions.length;
  return <button aria-current={selected ? 'true' : undefined} className={`catalog-row ${selected ? 'is-selected' : ''}`} onClick={onSelect} type="button">
    <span className="catalog-item">
      <span className={`catalog-tile ${tone}`} aria-hidden="true">{initials(row.item.name)}</span>
      <span className="catalog-name">
        <b>{row.item.name}</b>
        <small>
          {row.item.sku} · {row.item.category}
          {row.isLow && <i className="catalog-badge is-low">Low stock</i>}
          {!row.item.isActive && <i className="catalog-badge is-archived">Archived</i>}
        </small>
      </span>
    </span>
    <span className="catalog-stock">
      <span><strong>{row.onHand.toLocaleString()}</strong> {row.item.unit}{places > 0 && <> · {places} {places === 1 ? 'place' : 'places'}</>}</span>
      <span className="catalog-meter"><i className={row.isLow ? 'is-low' : ''} style={{ width: `${Math.max(3, Math.round(share * 100))}%` }} /></span>
    </span>
    <span className="catalog-price">
      {row.item.sellingPriceCents == null ? <strong className="is-missing">Set a price</strong> : <strong>{money(row.item.sellingPriceCents)}</strong>}
      <small>cost {money(row.item.unitCostCents)}</small>
    </span>
  </button>;
}

function ItemPanel({ row, tone }: { row: CatalogRow; tone: string }) {
  const { busy } = useInventoryStore();
  const { terms } = useCompanySettings();
  const toggleActive = useToggleItemActive();
  const [tab, setTab] = useState<ItemTab>(row.item.sellingPriceCents == null ? 'pricing' : 'stock');
  const [editing, setEditing] = useState(false);
  const { item } = row;
  const tabs: Array<{ key: ItemTab; label: string }> = [{ key: 'stock', label: 'Stock' }, { key: 'pricing', label: 'Pricing' }, { key: 'history', label: 'History' }];
  return <>
    <div className="item-panel-header">
      <span className={`catalog-tile is-large ${tone}`} aria-hidden="true">{initials(item.name)}</span>
      <div>
        <h2>{item.name}</h2>
        <p>{item.sku} · {item.category} · counted in {item.unit}</p>
      </div>
      <div className="item-panel-actions">
        <button className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => setEditing(true)} type="button"><Pencil size={16} /></button>
        <button className="icon-button" aria-label={`${item.isActive ? 'Archive' : 'Restore'} ${item.name}`} disabled={busy} onClick={() => void toggleActive(item)} type="button">{item.isActive ? <Archive size={16} /> : <RotateCcw size={16} />}</button>
      </div>
    </div>
    <div className="item-tabs" role="tablist" aria-label={`${terms.Item} sections`}>
      {tabs.map((option) => <button aria-selected={tab === option.key} className={tab === option.key ? 'is-active' : ''} key={option.key} onClick={() => setTab(option.key)} role="tab" type="button">{option.label}</button>)}
    </div>
    <div className="item-panel-body" role="tabpanel">
      {tab === 'stock' && <StockTab row={row} />}
      {tab === 'pricing' && <PricingTab item={item} />}
      {tab === 'history' && <HistoryTab item={item} />}
    </div>
    {editing && <ItemEditDialog item={item} onClose={() => setEditing(false)} />}
  </>;
}

function StockTab({ row }: { row: CatalogRow }) {
  const { money } = useCompanySettings();
  const value = row.positions.reduce((total, position) => total + position.valueCents, 0);
  if (!row.positions.length) return <EmptyState text={row.item.isActive ? 'No stock recorded at any place yet.' : 'Archived items hold no stock.'} />;
  return <>
    <div className="item-figures">
      <div className="item-figure is-dark"><span>On hand</span><strong className="is-count">{row.onHand.toLocaleString()}</strong><small>{row.item.unit} across {row.positions.length} {row.positions.length === 1 ? 'place' : 'places'}</small></div>
      <div className="item-figure"><span>Value at cost</span><strong>{money(value)}</strong><small>Reorder at {row.item.reorderLevel} per place</small></div>
    </div>
    <ul className="item-places">
      {row.positions.map((position) => <li key={position.location.id}>
        <span><b>{position.location.name}</b><small>{position.location.type === 'shop' ? 'Shop' : 'Warehouse'}</small></span>
        <span className="item-place-qty">
          {position.isLowStock && <i className="catalog-badge is-low">Low</i>}
          <strong>{position.closing.toLocaleString()}</strong> {row.item.unit}
        </span>
      </li>)}
    </ul>
  </>;
}

function PricingTab({ item }: { item: Item }) {
  const { accessToken } = useAuth();
  const { mutate, busy } = useInventoryStore();
  const { money } = useCompanySettings();
  const previewAvailable = usePricingPreviewAvailable();
  const [price, setPrice] = useState(item.sellingPriceCents == null ? '' : (item.sellingPriceCents / 100).toFixed(2));
  const unchanged = price === (item.sellingPriceCents == null ? '' : (item.sellingPriceCents / 100).toFixed(2));
  const margin = item.sellingPriceCents ? Math.round((item.sellingPriceCents - item.unitCostCents) / item.sellingPriceCents * 100) : null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || price === '') return;
    await mutate(() => api.updateSellingPrice(accessToken, item.id, Math.round(Number(price) * 100)), `Selling price updated for ${item.name}.`);
  };
  return <>
    <div className="item-figures">
      <div className="item-figure is-dark">
        <span>Price per {item.unit}</span>
        <strong>{item.sellingPriceCents == null ? 'Not set' : money(item.sellingPriceCents)}</strong>
        <small className="is-accent">{margin == null ? 'Shop attendants cannot sell it until it has a price' : `${margin}% margin on ${money(item.unitCostCents)} cost`}</small>
      </div>
      <form className="item-figure item-price-form" onSubmit={(event) => void save(event).catch(() => {})}>
        <label><span>{item.sellingPriceCents == null ? 'Set the selling price' : 'Change the selling price'}</span><InputControl aria-label={`Selling price per ${item.unit}`} type="number" min="0" max="21474836.47" step="0.01" required value={price} onValueChange={setPrice} /></label>
        <button className="button" disabled={busy || unchanged || price === ''} type="submit">Save price<Check size={15} /></button>
      </form>
    </div>
    <p className="item-note"><Info size={16} aria-hidden="true" />One price for every shop. Sales already made keep the price they were sold at.</p>
    {previewAvailable === true && <section className="item-hybrid pricing-preview-panel" aria-label="Box and quantity pricing">
      <h3>Box and quantity pricing</h3>
      <p>Sell a whole box or carton for less, or give a lower price per {item.unit} when someone buys more. Shops charge these prices automatically at checkout.</p>
      <p className="item-hybrid-notice">Changes apply to the next sale. Sales already made keep the price they were sold at.</p>
      <PricingEditor key={`${item.id}:${item.unit}:${item.sellingPriceCents}`} item={item} />
    </section>}
    {previewAvailable === false && <section className="item-hybrid item-hybrid-off" aria-label="Box and quantity pricing">
      <h3>Box and quantity pricing is off</h3>
      <p>Turn on <b>Box and quantity deals</b> to sell by the box or carton and give lower prices for bigger quantities. Until then, every {item.unit} sells at the price above.</p>
      <Link className="button secondary" to="/settings/inventory">Open settings</Link>
    </section>}
  </>;
}

function HistoryTab({ item }: { item: Item }) {
  const { accessToken } = useAuth();
  const { snapshot } = useInventoryStore();
  const { calendarDate } = useCompanySettings();
  const [history, setHistory] = useState<{ movements: Movement[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const generatedAt = snapshot?.generatedAt;
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void api.movementLedger(accessToken, { itemId: item.id, offset: 0, limit: 20 })
      .then((page) => { if (active) { setHistory(page); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [accessToken, item.id, generatedAt]);
  if (failed) return <div className="form-error" role="alert">Could not load the history for {item.name}.</div>;
  if (!history) return <div className="empty"><p>Loading history</p></div>;
  if (!history.movements.length) return <EmptyState text="Nothing has moved yet. Purchases, transfers and sales will appear here." />;
  return <>
    <ul className="item-history">
      {history.movements.map((movement) => <li key={movement.id}>
        <span className={`movement-icon ${movement.sign === 1 ? '' : 'out'}`} aria-hidden="true" />
        <span><b>{movementMeta[movement.type].label}</b><small>{calendarDate(movement.movementDate)} · {movement.destination ? `${movement.location?.name ?? 'Unknown'} → ${movement.destination.name}` : movement.location?.name ?? 'Unknown'}</small></span>
        <strong className={movement.sign === 1 ? 'positive' : 'negative'}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</strong>
      </li>)}
    </ul>
    {history.total > history.movements.length && <p className="item-note">Showing the latest {history.movements.length} of {history.total}. The full ledger is on the Movements page.</p>}
  </>;
}
