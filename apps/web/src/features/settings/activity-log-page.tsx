import { Activity, Building2, CircleDollarSign, Download, KeyRound, Package, ShieldCheck, UserRoundCog } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, Panel } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { SelectControl } from '../../components/ui/select-control';
import type { ActivityEvent } from '../../types';
import { SettingsNavigation } from './settings-navigation';

type ActivityCategory = 'all' | 'account' | 'inventory' | 'business';

const activityCopy: Record<string, { title: string; description: (event: ActivityEvent) => string }> = {
  'owner.email_verified': { title: 'Owner email verified', description: () => 'The business owner confirmed their email address.' },
  'owner.password_reset_requested': { title: 'Owner password reset requested', description: () => 'A public password recovery link was requested.' },
  'account.profile_updated': { title: 'Profile updated', description: (event) => event.metadata.emailChanged ? 'The account name and sign-in email were updated.' : 'The account name was updated.' },
  'account.password_changed': { title: 'Password changed', description: () => 'The owner changed their password from account settings.' },
  'account.password_reset_requested': { title: 'Staff reset link sent', description: () => 'An administrator sent a password reset link to a staff member.' },
  'account.password_reset_link_created': { title: 'Staff reset link created', description: () => 'An administrator created a password reset link for private sharing.' },
  'account.password_reset': { title: 'Password reset completed', description: () => 'A new password was saved and existing sessions were revoked.' },
  'account.invited': { title: 'Staff member invited', description: (event) => `A ${roleName(event.metadata.role)} account was invited.` },
  'account.invitation_resent': { title: 'Invitation sent again', description: () => 'A fresh staff invitation link was sent.' },
  'account.invitation_link_created': { title: 'Invitation link created', description: () => 'An administrator created an invitation link for private sharing.' },
  'account.invitation_accepted': { title: 'Invitation accepted', description: () => 'A staff member finished account setup.' },
  'account.activated': { title: 'Account activated', description: () => 'An administrator restored access to a staff account.' },
  'account.deactivated': { title: 'Account deactivated', description: () => 'An administrator removed access and revoked active sessions.' },
  'company.settings_updated': { title: 'Business settings updated', description: (event) => changedSettings(event.metadata.changedFields) },
  'data.exported': { title: 'Business data exported', description: (event) => `${exportName(event.metadata.type)} was downloaded as a CSV file.` },
  'inventory.items_imported': { title: 'Inventory imported', description: (event) => `${numberValue(event.metadata.imported)} items were added from a spreadsheet.` },
  'inventory.selling_price_changed': { title: 'Selling price changed', description: () => 'An administrator updated an item selling price.' },
  'inventory.item_updated': { title: 'Catalog item updated', description: (event) => event.metadata.isActive === false ? 'An inventory item was archived.' : 'An inventory item and its stock settings were updated.' },
  'inventory.supplier_created': { title: 'Supplier added', description: (event) => `${textValue(event.metadata.name, 'A supplier')} was added to the supplier directory.` },
  'inventory.supplier_updated': { title: 'Supplier updated', description: (event) => `${textValue(event.metadata.name, 'A supplier')} was updated.` },
  'inventory.stock_counted': { title: 'Physical stock counted', description: (event) => `The count found a variance of ${signedNumber(event.metadata.varianceQuantity)} units.` },
  'inventory.movement_deleted': { title: 'Movement removed', description: (event) => `${numberValue(event.metadata.quantity)} units were removed from the movement ledger.` },
};

export function ActivityLogPage() {
  const { accessToken, signOut } = useAuth();
  const { dateTime } = useCompanySettings();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [category, setCategory] = useState<ActivityCategory>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      setEvents(await api.activity(accessToken));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not load business activity');
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => events?.filter((event) => category === 'all' || eventCategory(event.action) === category) ?? [], [category, events]);

  return <>
    <PageHeader title="Activity log" subtitle="Account, inventory, and business changes recorded for this workspace." actions={<SelectControl aria-label="Activity category" value={category} onValueChange={(value) => setCategory(value as ActivityCategory)} options={[
      { value: 'all', label: 'All activity' },
      { value: 'account', label: 'Accounts and security' },
      { value: 'inventory', label: 'Inventory' },
      { value: 'business', label: 'Business settings' },
    ]} />} />
    <SettingsNavigation />
    {error && <div className="form-error settings-page-error" role="alert">{error}<button className="text-button" type="button" onClick={() => void load()}>Try again</button></div>}
    <Panel title={`Recent activity (${filtered.length})`} subtitle="The latest 100 recorded events are shown.">
      {events === null ? <div className="empty activity-loading"><StockLedgerMark animated size={34} /><p>Loading activity</p></div>
        : filtered.length ? <div className="activity-list">{filtered.map((event) => <ActivityRow dateTime={dateTime} event={event} key={event.id} />)}</div>
          : <EmptyState text="No activity matches this filter." />}
    </Panel>
  </>;
}

function ActivityRow({ event, dateTime }: { event: ActivityEvent; dateTime: (value: string) => string }) {
  const copy = activityCopy[event.action] ?? { title: sentenceCase(event.action), description: () => `A ${event.entityType.replaceAll('_', ' ')} record changed.` };
  const category = eventCategory(event.action);
  return <article className="activity-row">
    <span className={`activity-icon ${category}`}><ActivityIcon action={event.action} category={category} /></span>
    <div className="activity-copy"><h3>{copy.title}</h3><p>{copy.description(event)}</p><small>{event.actor?.fullName ?? 'System'} · {dateTime(event.createdAt)}</small></div>
    <span className={`activity-category ${category}`}>{category === 'business' ? 'Business' : category === 'inventory' ? 'Inventory' : 'Account'}</span>
  </article>;
}

function eventCategory(action: string): Exclude<ActivityCategory, 'all'> {
  if (action.startsWith('inventory.')) return 'inventory';
  if (action.startsWith('company.') || action.startsWith('data.')) return 'business';
  return 'account';
}

function ActivityIcon({ action, category }: { action: string; category: Exclude<ActivityCategory, 'all'> }) {
  if (action === 'data.exported') return <Download size={17} />;
  if (category === 'business') return <Building2 size={17} />;
  if (category === 'inventory') return action.includes('price') ? <CircleDollarSign size={17} /> : <Package size={17} />;
  if (action.includes('password')) return <KeyRound size={17} />;
  if (action.includes('verified') || action.includes('activated') || action.includes('deactivated')) return <ShieldCheck size={17} />;
  if (action.includes('profile') || action.includes('invitation') || action.includes('invited')) return <UserRoundCog size={17} />;
  return <Activity size={17} />;
}

function exportName(value: unknown) {
  if (value === 'inventory') return 'Inventory balances';
  if (value === 'movements') return 'The movement ledger';
  if (value === 'activity') return 'Activity history';
  return 'Business data';
}

function changedSettings(value: unknown) {
  if (!Array.isArray(value) || !value.length) return 'The shared business settings were saved.';
  const labels: Record<string, string> = { businessType: 'business type', contactEmail: 'contact email', timeZone: 'time zone', dateFormat: 'date format' };
  const fields = value.map((field) => labels[String(field)] ?? sentenceCase(String(field)).toLowerCase());
  return `${joinWords(fields)} ${fields.length === 1 ? 'was' : 'were'} updated.`;
}

function roleName(value: unknown) {
  return value === 'shop_attendant' ? 'shop attendant' : 'inventory manager';
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : 0;
}

function signedNumber(value: unknown) {
  const number = numberValue(value);
  return number > 0 ? `+${number}` : String(number);
}

function textValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function sentenceCase(value: string) {
  const words = value.replaceAll('.', ' ').replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function joinWords(values: string[]) {
  if (values.length < 2) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}
