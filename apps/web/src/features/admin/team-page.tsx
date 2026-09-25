import { Menu } from '@base-ui/react/menu';
import { ArrowUpRight, Mail, MoreHorizontal, UserRoundCheck, UserRoundX, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { PageHeader, Panel, SelectControl } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { roleLabel } from '../../lib/presentation';
import type { User } from '../../types';

export function TeamPage() {
  const { accessToken, signOut } = useAuth();
  const { snapshot } = useInventoryStore();
  const { memberDate } = useCompanySettings();
  const [people, setPeople] = useState<User[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', role: 'inventory_manager' as 'inventory_manager' | 'shop_attendant', locationId: '' });
  const shops = snapshot?.locations.filter((place) => place.type === 'shop') ?? [];

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setListError(null);
    try {
      setPeople(await api.users(accessToken));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      setListError(caught instanceof Error ? caught.message : 'Could not load accounts');
    } finally {
      setLoading(false);
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await api.addUser(accessToken, {
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        locationId: form.role === 'shop_attendant' ? form.locationId : undefined,
      });
      setPeople((current) => [...(current ?? []).filter((person) => person.id !== created.id), created]
        .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.email.localeCompare(right.email)));
      toast.success('Invitation sent', { description: `${created.fullName} will choose their password from the email invitation.` });
      setForm({ fullName: '', email: '', role: 'inventory_manager', locationId: '' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setFormError(caught instanceof Error ? caught.message : 'Could not add this account');
    } finally {
      setSubmitting(false);
    }
  };

  const sendPasswordReset = async (person: User) => {
    if (!accessToken) return;
    setBusyUserId(person.id);
    setActionError(null);
    try {
      await api.sendPasswordReset(accessToken, person.id);
      toast.success('Reset email sent', { description: `A 30-minute reset link was sent to ${person.email}.` });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setActionError(caught instanceof Error ? caught.message : 'Could not send the password reset');
    } finally {
      setBusyUserId(null);
    }
  };

  const resendInvitation = async (person: User) => {
    if (!accessToken) return;
    setBusyUserId(person.id);
    setActionError(null);
    try {
      await api.resendInvitation(accessToken, person.id);
      toast.success('Invitation sent again', { description: `A fresh setup link was sent to ${person.email}.` });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setActionError(caught instanceof Error ? caught.message : 'Could not resend this invitation');
    } finally {
      setBusyUserId(null);
    }
  };

  const setAccountStatus = async (person: User) => {
    if (!accessToken) return;
    const nextStatus = !person.isActive;
    setBusyUserId(person.id);
    setActionError(null);
    try {
      const updated = await api.setUserStatus(accessToken, person.id, nextStatus);
      setPeople((current) => current?.map((entry) => entry.id === updated.id ? updated : entry) ?? null);
      toast.success(updated.isActive ? 'Account activated' : 'Account deactivated', { description: `${updated.fullName} ${updated.isActive ? 'can sign in again' : 'can no longer sign in'}.` });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setActionError(caught instanceof Error ? caught.message : 'Could not update this account');
    } finally {
      setBusyUserId(null);
    }
  };

  return <>
    <PageHeader title="Team" subtitle="Add inventory managers and shop attendants." />
    <Panel title="Invite a person" subtitle="They will receive a secure link and choose their own password.">
      <form className="form-grid team-form" onSubmit={(event) => void submit(event)}>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <label><span>Full name</span><InputControl autoComplete="name" required maxLength={120} value={form.fullName} onValueChange={(fullName) => setForm({ ...form, fullName })} /></label>
        <label><span>Email address</span><InputControl autoComplete="off" inputMode="email" required type="email" maxLength={255} value={form.email} onValueChange={(email) => setForm({ ...form, email })} /></label>
        <label><span>Role</span><SelectControl aria-label="Role" value={form.role} onValueChange={(role) => setForm({ ...form, role: role as typeof form.role, locationId: '' })} options={[{ value: 'inventory_manager', label: 'Inventory manager' }, { value: 'shop_attendant', label: 'Shop attendant' }]} /></label>
        {form.role === 'shop_attendant' && <label><span>Shop</span><SelectControl aria-label="Shop" required value={form.locationId} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select shop' }, ...shops.map((shop) => ({ value: shop.id, label: shop.name }))]} /></label>}
        <button className="button" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Sending invite</> : <>Send invitation<ArrowUpRight size={16} /></>}</button>
      </form>
    </Panel>
    <Panel title={`People (${people?.length ?? 0})`} className="spaced">
      {actionError && <div className="form-error team-action-error" role="alert">{actionError}</div>}
      {loading && !people ? <div className="empty"><StockLedgerMark animated size={32} /><p>Loading accounts</p></div>
        : listError && !people ? <div className="empty"><p>{listError}</p><button className="button secondary" onClick={() => void load()}>Try again</button></div>
          : people?.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Place</th><th>Status</th><th className="num">Joined</th><th><span className="sr-only">Account actions</span></th></tr></thead><tbody>{people.map((person) => <tr className={person.isActive ? '' : 'inactive-account-row'} key={person.id}><td><b>{person.fullName}</b></td><td>{person.email}</td><td>{roleLabel[person.role]}</td><td>{snapshot?.locations.find((place) => place.id === person.locationId)?.name ?? 'All places'}</td><td><span className={`account-status ${person.setupPending ? 'pending' : person.isActive ? 'active' : 'inactive'}`}><i />{person.setupPending ? 'Invite pending' : person.isActive ? 'Active' : 'Inactive'}</span></td><td className="num">{memberDate(person.createdAt)}</td><td className="num">{person.role === 'administrator' ? <span className="account-owner-label">Owner</span> : <PersonActionsMenu person={person} busy={busyUserId === person.id} onReset={() => void sendPasswordReset(person)} onResendInvitation={() => void resendInvitation(person)} onStatusChange={() => void setAccountStatus(person)} />}</td></tr>)}</tbody></table></div>
            : <div className="empty"><Users size={22} /><p>No accounts yet.</p></div>}
    </Panel>
  </>;
}

function PersonActionsMenu({ person, busy, onReset, onResendInvitation, onStatusChange }: { person: User; busy: boolean; onReset: () => void; onResendInvitation: () => void; onStatusChange: () => void }) {
  return <Menu.Root>
    <Menu.Trigger className="row-menu-trigger" aria-label={`Manage ${person.fullName}`} disabled={busy}><MoreHorizontal size={18} /></Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner className="account-menu-positioner" align="end" side="bottom" sideOffset={6}>
        <Menu.Popup className="account-menu-popup row-actions-popup">
          {person.setupPending
            ? <Menu.Item className="account-menu-item" disabled={!person.isActive} onClick={onResendInvitation}><Mail size={17} /><span>Resend invitation</span></Menu.Item>
            : <Menu.Item className="account-menu-item" disabled={!person.isActive} onClick={onReset}><Mail size={17} /><span>Send password reset</span></Menu.Item>}
          <div className="account-menu-separator" />
          <Menu.Item className={`account-menu-item ${person.isActive ? 'danger' : ''}`} onClick={onStatusChange}>{person.isActive ? <UserRoundX size={17} /> : <UserRoundCheck size={17} />}<span>{person.isActive ? 'Deactivate account' : 'Activate account'}</span></Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
