import { Building2, Globe2, Phone, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { SelectControl } from '../../components/ui/select-control';
import { formatMoney } from '../../lib/presentation';
import type { CompanyProfileSettings, CompanySettings } from '../../types';
import { SettingsNavigation } from './settings-navigation';
import { SettingsSaveBar } from './settings-save-bar';

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
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'America/New_York', label: 'New York (ET)' },
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
  if (!settings) return <><PageHeader title="Business settings" /><div className="form-error settings-page-error" role="alert">{error ?? 'Business settings are not available'}</div></>;

  return <BusinessSettingsForm key={JSON.stringify(settings)} initialSettings={settings} loadError={error} />;
}

function BusinessSettingsForm({ initialSettings, loadError }: { initialSettings: CompanySettings; loadError: string | null }) {
  const { save } = useCompanySettings();
  const initial = useMemo(() => editableSettings(initialSettings), [initialSettings]);
  const [form, setForm] = useState<CompanyProfileSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const currencyChanged = form.currency !== initial.currency;
  const typeLabel = businessTypes.find((type) => type.value === form.businessType)?.label;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await save(form);
      toast.success('Business settings saved');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save business settings');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PageHeader title="Business settings" />
    <SettingsNavigation />
    {(loadError || error) && <div className="form-error settings-page-error" role="alert">{error ?? loadError}</div>}
    <form className="settings-content-column business-settings" onSubmit={(event) => void submit(event)}>
      <section className="business-identity" aria-label="Business summary">
        <span className="business-identity-mark" aria-hidden="true">{initials(form.name)}</span>
        <div>
          <h2>{form.name || 'Your business'}</h2>
          <p>{[typeLabel, form.address].filter(Boolean).join(' · ') || 'Add your business details below.'}</p>
        </div>
      </section>

      <SettingsSection icon={Building2} title="Business details" description="Your business name appears at the top of StockLedger and in emails to your team.">
        <label><span>Business name</span><InputControl required maxLength={120} value={form.name} onValueChange={(name) => setForm({ ...form, name })} /></label>
        <label><span>What kind of business is it?</span><SelectControl aria-label="Business type" required value={form.businessType} onValueChange={(businessType) => setForm({ ...form, businessType: businessType as CompanySettings['businessType'] })} options={businessTypes} /></label>
      </SettingsSection>

      <SettingsSection icon={Phone} title="Contact" description="How people can reach the business. Only your team sees these details.">
        <label><span>Email address</span><InputControl required type="email" inputMode="email" maxLength={255} value={form.contactEmail} onValueChange={(contactEmail) => setForm({ ...form, contactEmail })} /></label>
        <label><span>Phone number <small>Optional</small></span><InputControl type="tel" maxLength={40} placeholder="+233 20 000 0000" value={form.phone} onValueChange={(phone) => setForm({ ...form, phone })} /></label>
        <label className="settings-wide-field"><span>Address <small>Optional</small></span><InputControl maxLength={300} placeholder="Street, area and city" value={form.address} onValueChange={(address) => setForm({ ...form, address })} /></label>
      </SettingsSection>

      <SettingsSection icon={Globe2} title="Money and dates" description="How prices, dates and times appear for everyone in your business.">
        <label><span>Currency</span><SelectControl aria-label="Currency" required value={form.currency} onValueChange={(currency) => setForm({ ...form, currency: currency as CompanySettings['currency'] })} options={currencies} /></label>
        <label><span>Time zone</span><SelectControl aria-label="Time zone" required value={form.timeZone} onValueChange={(timeZone) => setForm({ ...form, timeZone: timeZone as CompanySettings['timeZone'] })} options={timeZones} /></label>
        <label><span>Date style</span><SelectControl aria-label="Date format" required value={form.dateFormat} onValueChange={(dateFormat) => setForm({ ...form, dateFormat: dateFormat as CompanySettings['dateFormat'] })} options={dateFormats} /></label>
        {currencyChanged && <p className="settings-warning settings-wide-field" role="status"><TriangleAlert size={16} aria-hidden="true" /><span>Only the money sign changes. Prices and costs are not converted: {formatMoney(1000, initial.currency)} becomes {formatMoney(1000, form.currency)}.</span></p>}
        <div className="settings-preview settings-wide-field" aria-label="Preview">
          <span>Your team will see</span>
          <dl>
            <div><dt>Money</dt><dd>{formatMoney(125050, form.currency)}</dd></div>
            <div><dt>Date</dt><dd>{previewDate(form.dateFormat)}</dd></div>
            <div><dt>Time now</dt><dd>{previewTime(form.timeZone)}</dd></div>
          </dl>
        </div>
      </SettingsSection>

      <SettingsSaveBar changed={changed} saving={saving} onDiscard={() => setForm(initial)} />
    </form>
  </>;
}

function SettingsSection({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return <section className="panel settings-section">
    <header><span className="settings-section-icon"><Icon size={18} /></span><h2>{title}</h2><p>{description}</p></header>
    <div className="settings-fields">{children}</div>
  </section>;
}

function initials(name: string) {
  return name.split(/\s+/).filter((word) => /^\p{L}/u.test(word)).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || 'SL';
}

function previewDate(format: CompanySettings['dateFormat']) {
  const today = new Date();
  if (format === 'year_month_day') return today.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat(format === 'month_day_year' ? 'en-US' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(today);
}

function previewTime(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date());
}

function editableSettings(settings: CompanySettings): CompanyProfileSettings {
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
