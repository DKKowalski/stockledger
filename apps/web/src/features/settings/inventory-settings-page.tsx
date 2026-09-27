import { Barcode, Boxes, MapPin, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { PageHeader, Panel } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { SelectControl } from '../../components/ui/select-control';
import type { InventorySettings, Place } from '../../types';
import { SettingsNavigation } from './settings-navigation';

export function InventorySettingsPage() {
  const { accessToken } = useAuth();
  const { settings, loading, error, saveInventory } = useCompanySettings();
  const [locations, setLocations] = useState<Place[]>([]);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void api.snapshot(accessToken, 30).then((snapshot) => setLocations(snapshot.locations)).catch((caught: unknown) => {
      setLocationsError(caught instanceof Error ? caught.message : 'Could not load locations');
    });
  }, [accessToken]);

  if (loading && !settings) return <div className="empty page-state"><StockLedgerMark animated size={40} /><p>Loading inventory settings</p></div>;
  if (!settings) return <><PageHeader title="Inventory settings" subtitle="Defaults and safeguards for daily stock work." /><div className="form-error settings-page-error">{error ?? 'Inventory settings are not available'}</div></>;

  return <InventorySettingsForm key={JSON.stringify(settings)} initial={settings} locations={locations} loadError={error ?? locationsError} save={saveInventory} />;
}

function InventorySettingsForm({ initial, locations, loadError, save }: { initial: InventorySettings; locations: Place[]; loadError: string | null; save: (value: InventorySettings) => Promise<unknown> }) {
  const [form, setForm] = useState<InventorySettings>(initial);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const changed = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await save(form);
      toast.success('Inventory settings saved');
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Could not save inventory settings');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PageHeader title="Inventory settings" subtitle="Set sensible defaults and decide how strict stock recording should be." />
    <SettingsNavigation />
    {(loadError || formError) && <div className="form-error settings-page-error" role="alert">{formError ?? loadError}</div>}
    <form className="settings-content-column" onSubmit={(event) => void submit(event)}>
      <Panel title="New inventory defaults" subtitle="Pre-fill common values when someone adds or imports inventory.">
        <div className="settings-fields regional-settings-fields">
          <label><span><MapPin size={14} />Opening location</span><SelectControl aria-label="Default opening location" value={form.defaultLocationId ?? ''} onValueChange={(value) => setForm({ ...form, defaultLocationId: value || null })} options={[{ value: '', label: 'Ask every time' }, ...locations.map((location) => ({ value: location.id, label: location.name }))]} /></label>
          <label><span><Boxes size={14} />Default unit</span><InputControl required maxLength={20} value={form.defaultUnit} onValueChange={(defaultUnit) => setForm({ ...form, defaultUnit })} /></label>
          <label><span>Default reorder level</span><InputControl required min={0} type="number" value={String(form.defaultReorderLevel)} onValueChange={(value) => setForm({ ...form, defaultReorderLevel: Math.max(0, Number(value) || 0) })} /></label>
        </div>
      </Panel>

      <Panel className="spaced" title="Automatic item codes" subtitle="Blank item codes use a predictable sequence instead of a name-based code.">
        <div className="settings-fields">
          <label><span><Barcode size={14} />Prefix</span><InputControl required maxLength={12} value={form.skuPrefix} onValueChange={(skuPrefix) => setForm({ ...form, skuPrefix: skuPrefix.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} /></label>
          <label><span>Next number</span><InputControl required min={1} max={999999999} type="number" value={String(form.nextSkuNumber)} onValueChange={(value) => setForm({ ...form, nextSkuNumber: Math.max(1, Number(value) || 1) })} /></label>
          <div className="settings-code-preview"><span>Next generated code</span><strong>{form.skuPrefix || 'SKU'}-{String(form.nextSkuNumber).padStart(4, '0')}</strong></div>
        </div>
      </Panel>

      <Panel className="spaced" title="Recording safeguards" subtitle="These rules are checked by the API for every stock change.">
        <div className="settings-switch-list">
          <SettingsSwitch checked={form.allowNegativeStock} title="Allow negative stock" description="Let outgoing stock take a location below zero when the physical count is ahead of the system." onChange={(allowNegativeStock) => setForm({ ...form, allowNegativeStock })} />
          <SettingsSwitch checked={form.requirePurchaseSource} title="Require a purchase source" description="Every purchase needs either a supplier or a reference number." onChange={(requirePurchaseSource) => setForm({ ...form, requirePurchaseSource })} />
          <SettingsSwitch checked={form.requireAdjustmentReason} title="Require adjustment reasons" description="Damage and non-zero stock-count variances need a note." onChange={(requireAdjustmentReason) => setForm({ ...form, requireAdjustmentReason })} />
        </div>
      </Panel>

      <div className="settings-save-bar"><span>{changed ? 'You have unsaved changes.' : 'Everything is up to date.'}</span><button className="button" disabled={saving || !changed}>{saving ? <><StockLedgerMark animated size={20} />Saving</> : <><Save size={16} />Save inventory settings</>}</button></div>
    </form>
  </>;
}

function SettingsSwitch({ checked, title, description, onChange }: { checked: boolean; title: string; description: string; onChange: (checked: boolean) => void }) {
  return <label className="settings-switch-row">
    <span className="settings-switch-copy"><b><ShieldCheck size={16} />{title}</b><small>{description}</small></span>
    <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
    <span className="settings-switch" aria-hidden="true"><i /></span>
  </label>;
}
