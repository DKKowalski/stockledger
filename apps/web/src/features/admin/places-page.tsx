import { ArrowUpRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, PageState, Panel, SelectControl } from '../../components/inventory-ui';
import { placeLabel } from '../../lib/presentation';
import type { LocationType } from '../../types';

export function PlacesPage() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useInventoryStore();
  const [form, setForm] = useState({ name: '', type: 'shop' as LocationType });
  const places = snapshot?.locations ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addLocation(accessToken, form), `${form.name} was added.`);
    setForm({ name: '', type: 'shop' });
  };

  return <PageState>
    <PageHeader title="Places" subtitle="Warehouses and shops that hold their own stock." />
    <Panel title="Add a place" subtitle="Stock can move between any warehouse or shop.">
      <form className="form-grid place-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label><span>Name</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label><span>Type</span><SelectControl value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as LocationType })}><option value="shop">Shop</option><option value="warehouse">Warehouse</option></SelectControl></label>
        <button className="button" disabled={busy}>Add place<ArrowUpRight size={16} /></button>
      </form>
    </Panel>
    <Panel title={`Places (${places.length})`} className="spaced">
      {places.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>{places.map((place) => <tr key={place.id}><td><b>{place.name}</b></td><td>{placeLabel[place.type]}</td></tr>)}</tbody></table></div> : <EmptyState text="No places yet." />}
    </Panel>
  </PageState>;
}
