import { ArrowUpRight, Building2, Globe2, MapPin, ReceiptText } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader, Panel } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { SelectControl } from '../../components/ui/select-control';
import { formatMoney } from '../../lib/presentation';
import type { CompanySettings } from '../../types';
import { SettingsNavigation } from './settings-navigation';

const businessTypes = [
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'warehouse', label: 'Warehouse operations' },
  { value: 'mixed', label: 'Retail and wholesale' },
] as const;

const currencies = [
  { value: 'GHS', label: 'Ghanaian cedi (GHS)' },
  { value: 'USD', label: 'US dollar (USD)' },
  { value: 'NGN', label: 'Nigerian naira (NGN)' },
  { value: 'GBP', label: 'British pound (GBP)' },
  { value: 'EUR', label: 'Euro (EUR)' },
] as const;

const timeZones = [
  { value: 'Africa/Accra', label: 'Accra (GMT)' },
  { value: 'Africa/Lagos', label: 'Lagos (WAT)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'UTC', label: 'UTC' },
] as const;

const dateFormats = [
  { value: 'day_month_year', label: '25 Sep 2026' },
  { value: 'month_day_year', label: 'Sep 25, 2026' },
  { value: 'year_month_day', label: '2026-09-25' },
] as const;

export function BusinessSettingsPage() {
  const { settings, loading, error } = useCompanySettings();

  if (loading && !settings) return <div className="empty page-state"><StockLedgerMark animated size={40} /><p>Loading business settings</p></div>;
  if (!settings) return <><PageHeader title="Business settings" subtitle="Company details and regional defaults shared across StockLedger." /><div className="form-error settings-page-error" role="alert">{error ?? 'Business settings are not available'}</div></>;

  return <BusinessSettingsForm key={JSON.stringify(settings)} initialSettings={settings} loadError={error} />;
}

function BusinessSettingsForm({ initialSettings, loadError }: { initialSettings: CompanySettings; loadError: string | null }) {
  const { save } = useCompanySettings();
  const [form, setForm] = useState<Omit<CompanySettings, 'id'>>(() => editableSettings(initialSettings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = useMemo(() => JSON.stringify(form) !== JSON.stringify(editableSettings(initialSettings)), [form, initialSettings]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await save(form);
      toast.success('Business settings saved', { description: 'Currency and regional changes now apply across the workspace.' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save business settings');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PageHeader title="Business settings" subtitle="Company details and regional defaults shared across StockLedger." />
    <SettingsNavigation />
    {(loadError || error) && <div className="form-error settings-page-error" role="alert">{error ?? loadError}</div>}
    <form className="business-settings-form" onSubmit={(event) => void submit(event)}>
      <aside className="panel settings-summary">
        <span className="settings-summary-icon"><Building2 size={21} /></span>
        <h2>{form.name || 'Your business'}</h2>
        <p>These details belong to the company, not your personal account.</p>
        <dl>
          <div><dt><ReceiptText size={14} />Currency</dt><dd>{form.currency}</dd></div>
          <div><dt><Globe2 size={14} />Time zone</dt><dd>{form.timeZone}</dd></div>
          <div><dt><MapPin size={14} />Location</dt><dd>{form.address || 'Not added'}</dd></div>
        </dl>
        <div className="settings-money-preview"><span>Currency preview</span><strong>{formatMoney(125050, form.currency)}</strong></div>
      </aside>

      <div className="settings-sections">
        <Panel title="Business profile" subtitle="Used across your workspace and account emails.">
          <div className="settings-fields">
            <label><span>Business name</span><InputControl required maxLength={120} value={form.name} onValueChange={(name) => setForm({ ...form, name })} /></label>
            <label><span>Business type</span><SelectControl aria-label="Business type" required value={form.businessType} onValueChange={(businessType) => setForm({ ...form, businessType: businessType as CompanySettings['businessType'] })} options={businessTypes} /></label>
            <label><span>Contact email</span><InputControl required type="email" inputMode="email" maxLength={255} value={form.contactEmail} onValueChange={(contactEmail) => setForm({ ...form, contactEmail })} /></label>
            <label><span>Phone number</span><InputControl type="tel" maxLength={40} placeholder="Optional" value={form.phone} onValueChange={(phone) => setForm({ ...form, phone })} /></label>
            <label className="settings-wide-field"><span>Business address</span><InputControl maxLength={300} placeholder="Optional" value={form.address} onValueChange={(address) => setForm({ ...form, address })} /></label>
          </div>
        </Panel>

        <Panel title="Regional preferences" subtitle="Controls how money and dates appear for everyone." className="spaced">
          <div className="settings-fields regional-settings-fields">
            <label><span>Currency</span><SelectControl aria-label="Currency" required value={form.currency} onValueChange={(currency) => setForm({ ...form, currency: currency as CompanySettings['currency'] })} options={currencies} /></label>
            <label><span>Time zone</span><SelectControl aria-label="Time zone" required value={form.timeZone} onValueChange={(timeZone) => setForm({ ...form, timeZone: timeZone as CompanySettings['timeZone'] })} options={timeZones} /></label>
            <label><span>Date format</span><SelectControl aria-label="Date format" required value={form.dateFormat} onValueChange={(dateFormat) => setForm({ ...form, dateFormat: dateFormat as CompanySettings['dateFormat'] })} options={dateFormats} /></label>
          </div>
        </Panel>

        <div className="settings-save-bar">
          <span>{changed ? 'You have unsaved changes.' : 'Everything is up to date.'}</span>
          <button className="button" disabled={saving || !changed}>{saving ? <><StockLedgerMark animated size={20} />Saving</> : <>Save settings<ArrowUpRight size={16} /></>}</button>
        </div>
      </div>
    </form>
  </>;
}

function editableSettings(settings: CompanySettings): Omit<CompanySettings, 'id'> {
  return {
    name: settings.name,
    businessType: settings.businessType,
    contactEmail: settings.contactEmail,
    phone: settings.phone,
    address: settings.address,
    currency: settings.currency,
    timeZone: settings.timeZone,
    dateFormat: settings.dateFormat,
  };
}
