import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import type { Item } from '../../types';

/** Search the caller's permitted items; availability always comes from its scoped snapshot. */
export function ProductPicker({ items, value, onValueChange, locationId, disabled, required, selling = false, label }: {
  items: Item[]; value: string; onValueChange: (value: string) => void; locationId?: string | null;
  disabled?: boolean; required?: boolean; selling?: boolean; label?: string;
}) {
  const { snapshot } = useInventoryStore();
  const { money, terms } = useCompanySettings();
  const stock = new Map<string, number>();
  for (const position of snapshot?.positions ?? []) {
    if (!locationId || position.location.id === locationId) stock.set(position.item.id, (stock.get(position.item.id) ?? 0) + position.closing);
  }
  const available = (item: Item) => stock.get(item.id) ?? 0;
  const place = snapshot?.locations.find(place => place.id === locationId)?.name;
  const detail = (item: Item) => `${item.sku} · ${item.sellingPriceCents == null ? 'Price not set' : money(item.sellingPriceCents)} · ${available(item)} ${item.unit} ${available(item) > 0 ? 'available' : '— out of stock'}${place ? ` at ${place}` : ' across all places'}`;
  return <Combobox.Root<Item> items={items} value={items.find(item => item.id === value) ?? null}
    onValueChange={item => onValueChange(item?.id ?? '')} disabled={disabled} required={required}
    itemToStringLabel={item => item.name} itemToStringValue={item => item.id} isItemEqualToValue={(a, b) => a.id === b.id}
    filter={(item, query) => `${item.name} ${item.sku}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}>
    <Combobox.Trigger className="select-trigger product-picker-trigger" aria-label={label ?? terms.Item}>
      <span className="select-value"><Combobox.Value placeholder={`Select ${terms.item}`} /></span><ChevronDown className="select-icon" size={15} />
    </Combobox.Trigger>
    <Combobox.Portal><Combobox.Positioner className="product-picker-positioner" sideOffset={6}>
      <Combobox.Popup className="product-picker-popup" aria-label={`Choose ${terms.item}`}>
        <div className="product-picker-search"><Search size={17} aria-hidden="true" /><Combobox.Input aria-label={`Search ${terms.items} by name or code`} placeholder="Search name or code" /></div>
        <Combobox.Empty className="product-picker-empty">No matching {terms.items}. Try the name or code.</Combobox.Empty>
        <Combobox.List className="product-picker-list">{(item: Item) => <Combobox.Item key={item.id} value={item} className="product-picker-option" aria-label={item.name} aria-description={detail(item)} disabled={selling && (available(item) <= 0 || item.sellingPriceCents == null)}>
          <div><b>{item.name}</b><small>{detail(item)}</small></div><Combobox.ItemIndicator><Check size={16} /></Combobox.ItemIndicator>
        </Combobox.Item>}</Combobox.List>
      </Combobox.Popup>
    </Combobox.Positioner></Combobox.Portal>
  </Combobox.Root>;
}
