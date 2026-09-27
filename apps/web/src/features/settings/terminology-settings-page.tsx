import { BookType, Check, Package, Save, Store, Warehouse } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader, Panel } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import type { CompanySettings, TerminologySettings } from '../../types';
import { SettingsNavigation } from './settings-navigation';

export function TerminologySettingsPage() {
  const { settings, loading, error, saveTerminology } = useCompanySettings();
  if (loading && !settings) return <div className="empty page-state"><StockLedgerMark animated size={40} /><p>Loading terminology</p></div>;
  if (!settings) return <><PageHeader title="Workspace words" subtitle="Use the language your team already knows." /><div className="form-error settings-page-error">{error ?? 'Terminology settings are not available'}</div></>;
  return <TerminologyForm key={`${settings.shopTerm}:${settings.warehouseTerm}:${settings.itemTerm}`} settings={settings} save={saveTerminology} />;
}

function TerminologyForm({ settings, save }: { settings: CompanySettings; save: (value: TerminologySettings) => Promise<unknown> }) {
  const initial = useMemo<TerminologySettings>(() => ({ shopTerm: settings.shopTerm, warehouseTerm: settings.warehouseTerm, itemTerm: settings.itemTerm }), [settings]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try { await save(form); toast.success('Workspace words updated', { description: 'Your team will now see the new labels across StockLedger.' }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save workspace words'); }
    finally { setSaving(false); }
  };
  return <>
    <PageHeader title="Workspace words" subtitle="Choose familiar labels without changing how your inventory data works." />
    <SettingsNavigation />
    {error && <div className="form-error settings-page-error">{error}</div>}
    <form className="settings-content-column" onSubmit={(event) => void submit(event)}>
      <Panel title="Your team's language" subtitle="These labels appear in navigation, forms, reports, and filters.">
        <div className="terminology-groups">
          <TermGroup icon={<Store size={18} />} label="Customer-facing location" value={form.shopTerm} options={['shop', 'branch', 'outlet', 'store']} onChange={(shopTerm) => setForm({ ...form, shopTerm: shopTerm as TerminologySettings['shopTerm'] })} />
          <TermGroup icon={<Warehouse size={18} />} label="Storage location" value={form.warehouseTerm} options={['warehouse', 'stockroom']} onChange={(warehouseTerm) => setForm({ ...form, warehouseTerm: warehouseTerm as TerminologySettings['warehouseTerm'] })} />
          <TermGroup icon={<Package size={18} />} label="Inventory record" value={form.itemTerm} options={['item', 'product', 'material']} onChange={(itemTerm) => setForm({ ...form, itemTerm: itemTerm as TerminologySettings['itemTerm'] })} />
        </div>
      </Panel>
      <div className="terminology-preview"><BookType size={18} /><span>Your team will read:</span><b>{capital(form.itemTerm)} stock across every {form.shopTerm} and {form.warehouseTerm}</b></div>
      <div className="settings-save-bar"><span>{changed ? 'You have unsaved changes.' : 'Everything is up to date.'}</span><button className="button" disabled={saving || !changed}>{saving ? <><StockLedgerMark animated size={20} />Saving</> : <><Save size={16} />Save words</>}</button></div>
    </form>
  </>;
}

function TermGroup({ icon, label, value, options, onChange }: { icon: ReactNode; label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <fieldset className="terminology-group"><legend>{icon}<span>{label}</span></legend><div>{options.map((option) => <button aria-pressed={value === option} className={value === option ? 'selected' : ''} key={option} onClick={() => onChange(option)} type="button"><span>{capital(option)}</span>{value === option && <Check size={15} />}</button>)}</div></fieldset>;
}

function capital(value: string) { return value[0]!.toUpperCase() + value.slice(1); }
