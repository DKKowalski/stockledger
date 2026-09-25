import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { ArrowUpRight, Check, Copy, Link2, Mail, MoreHorizontal, UserRoundCheck, UserRoundX, Users, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { PageHeader, Panel, SelectControl } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { roleLabel } from '../../lib/presentation';
import type { AccountAccessLink, User } from '../../types';

type ShareableLink = AccountAccessLink & { personName: string; purpose: 'invitation' | 'password reset' };

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
  const [submittingDelivery, setSubmittingDelivery] = useState<'email' | 'link'>('email');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [shareableLink, setShareableLink] = useState<ShareableLink | null>(null);
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'manual'>('ready');
  const closeTimer = useRef<number | null>(null);
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

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const closeShareDialog = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setShareableLink(null);
    setCopyState('ready');
  };

  const presentLink = async (link: AccountAccessLink, personName: string, purpose: ShareableLink['purpose']) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setShareableLink({ ...link, personName, purpose });
    setCopyState('ready');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText(link.url);
      setCopyState('copied');
      closeTimer.current = window.setTimeout(() => {
        setShareableLink(null);
        setCopyState('ready');
        closeTimer.current = null;
      }, 4000);
    } catch {
      setCopyState('manual');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const delivery = submitter?.value === 'link' ? 'link' : 'email';
    setSubmittingDelivery(delivery);
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.addUser(accessToken, {
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        locationId: form.role === 'shop_attendant' ? form.locationId : undefined,
        delivery,
      });
      const created = result.user;
      setPeople((current) => [...(current ?? []).filter((person) => person.id !== created.id), created]
        .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.email.localeCompare(right.email)));
      if (result.invitation) await presentLink(result.invitation, created.fullName, 'invitation');
      else toast.success('Invitation sent', { description: `${created.fullName} will choose their password from the email invitation.` });
      setForm({ fullName: '', email: '', role: 'inventory_manager', locationId: '' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setFormError(caught instanceof Error ? caught.message : 'Could not add this account');
    } finally {
      setSubmitting(false);
    }
  };

  const createPasswordResetLink = async (person: User) => {
    if (!accessToken) return;
    setBusyUserId(person.id);
    setActionError(null);
    try {
      await presentLink(await api.createPasswordResetLink(accessToken, person.id), person.fullName, 'password reset');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setActionError(caught instanceof Error ? caught.message : 'Could not create the password reset link');
    } finally {
      setBusyUserId(null);
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

  const createInvitationLink = async (person: User) => {
    if (!accessToken) return;
    setBusyUserId(person.id);
    setActionError(null);
    try {
      await presentLink(await api.createInvitationLink(accessToken, person.id), person.fullName, 'invitation');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setActionError(caught instanceof Error ? caught.message : 'Could not create the invitation link');
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
    <Panel title="Invite a person" subtitle="Send the setup link by email or copy it for private sharing.">
      <form className="form-grid team-form" onSubmit={(event) => void submit(event)}>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <label><span>Full name</span><InputControl autoComplete="name" required maxLength={120} value={form.fullName} onValueChange={(fullName) => setForm({ ...form, fullName })} /></label>
        <label><span>Email address</span><InputControl autoComplete="off" inputMode="email" required type="email" maxLength={255} value={form.email} onValueChange={(email) => setForm({ ...form, email })} /></label>
        <label><span>Role</span><SelectControl aria-label="Role" value={form.role} onValueChange={(role) => setForm({ ...form, role: role as typeof form.role, locationId: '' })} options={[{ value: 'inventory_manager', label: 'Inventory manager' }, { value: 'shop_attendant', label: 'Shop attendant' }]} /></label>
        {form.role === 'shop_attendant' && <label><span>Shop</span><SelectControl aria-label="Shop" required value={form.locationId} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select shop' }, ...shops.map((shop) => ({ value: shop.id, label: shop.name }))]} /></label>}
        <div className="team-form-actions">
          <button className="button" name="delivery" value="email" disabled={submitting}>{submitting && submittingDelivery === 'email' ? <><StockLedgerMark animated size={20} />Sending</> : <>Send email<ArrowUpRight size={16} /></>}</button>
          <button className="button secondary" name="delivery" value="link" disabled={submitting}>{submitting && submittingDelivery === 'link' ? <><StockLedgerMark animated size={20} />Creating</> : <><Copy size={16} />Create and copy link</>}</button>
        </div>
      </form>
    </Panel>
    <Dialog.Root open={Boolean(shareableLink)} onOpenChange={(open) => { if (!open) closeShareDialog(); }}>
      {shareableLink && <Dialog.Portal>
        <Dialog.Backdrop className="team-share-backdrop" />
        <Dialog.Viewport className="team-share-viewport">
          <Dialog.Popup className="team-share-dialog">
            <div className="team-share-heading">
              <div className="team-share-link-icon"><Link2 size={19} /></div>
              <div>
                <Dialog.Title>{shareableLink.purpose === 'invitation' ? 'Invitation' : 'Password reset'} link</Dialog.Title>
                <Dialog.Description>Send this link privately to {shareableLink.personName}.</Dialog.Description>
              </div>
              <Dialog.Close className="team-share-dismiss" aria-label="Close link dialog"><X size={17} /></Dialog.Close>
            </div>
            <div className="team-share-warning">Anyone with this link can set this account's password. It expires {new Date(shareableLink.expiresAt).toLocaleString()}.</div>
            <div className="team-share-field">
              <input aria-label={`${shareableLink.purpose} link for ${shareableLink.personName}`} readOnly value={shareableLink.url} onFocus={(event) => event.currentTarget.select()} />
              <button className="button secondary" type="button" onClick={() => void presentLink(shareableLink, shareableLink.personName, shareableLink.purpose)}>{copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}{copyState === 'copied' ? 'Copied' : 'Copy link'}</button>
            </div>
            <div className={`team-share-status ${copyState}`} aria-live="polite">
              {copyState === 'copied' ? <><Check size={14} /><span>Copied. This window will close in a few seconds.</span></> : copyState === 'manual' ? <span>Automatic copy was blocked. Select the link above or try again.</span> : <span>Preparing the link.</span>}
            </div>
            {copyState === 'copied' && <div className="team-share-timeout" aria-hidden="true"><i /></div>}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>}
    </Dialog.Root>
    <Panel title={`People (${people?.length ?? 0})`} className="spaced">
      {actionError && <div className="form-error team-action-error" role="alert">{actionError}</div>}
      {loading && !people ? <div className="empty"><StockLedgerMark animated size={32} /><p>Loading accounts</p></div>
        : listError && !people ? <div className="empty"><p>{listError}</p><button className="button secondary" onClick={() => void load()}>Try again</button></div>
          : people?.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Place</th><th>Status</th><th className="num">Joined</th><th><span className="sr-only">Account actions</span></th></tr></thead><tbody>{people.map((person) => <tr className={person.isActive ? '' : 'inactive-account-row'} key={person.id}><td><b>{person.fullName}</b></td><td>{person.email}</td><td>{roleLabel[person.role]}</td><td>{snapshot?.locations.find((place) => place.id === person.locationId)?.name ?? 'All places'}</td><td><span className={`account-status ${person.setupPending ? 'pending' : person.isActive ? 'active' : 'inactive'}`}><i />{person.setupPending ? 'Invite pending' : person.isActive ? 'Active' : 'Inactive'}</span></td><td className="num">{memberDate(person.createdAt)}</td><td className="num">{person.role === 'administrator' ? <span className="account-owner-label">Owner</span> : <PersonActionsMenu person={person} busy={busyUserId === person.id} onReset={() => void sendPasswordReset(person)} onCopyReset={() => void createPasswordResetLink(person)} onResendInvitation={() => void resendInvitation(person)} onCopyInvitation={() => void createInvitationLink(person)} onStatusChange={() => void setAccountStatus(person)} />}</td></tr>)}</tbody></table></div>
            : <div className="empty"><Users size={22} /><p>No accounts yet.</p></div>}
    </Panel>
  </>;
}

function PersonActionsMenu({ person, busy, onReset, onCopyReset, onResendInvitation, onCopyInvitation, onStatusChange }: { person: User; busy: boolean; onReset: () => void; onCopyReset: () => void; onResendInvitation: () => void; onCopyInvitation: () => void; onStatusChange: () => void }) {
  return <Menu.Root>
    <Menu.Trigger className="row-menu-trigger" aria-label={`Manage ${person.fullName}`} disabled={busy}><MoreHorizontal size={18} /></Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner className="account-menu-positioner" align="end" side="bottom" sideOffset={6}>
        <Menu.Popup className="account-menu-popup row-actions-popup">
          {person.setupPending
            ? <><Menu.Item className="account-menu-item" disabled={!person.isActive} onClick={onResendInvitation}><Mail size={17} /><span>Resend invitation</span></Menu.Item><Menu.Item className="account-menu-item" disabled={!person.isActive} onClick={onCopyInvitation}><Link2 size={17} /><span>Copy invitation link</span></Menu.Item></>
            : <><Menu.Item className="account-menu-item" disabled={!person.isActive} onClick={onReset}><Mail size={17} /><span>Send password reset</span></Menu.Item><Menu.Item className="account-menu-item" disabled={!person.isActive} onClick={onCopyReset}><Link2 size={17} /><span>Copy reset link</span></Menu.Item></>}
          <div className="account-menu-separator" />
          <Menu.Item className={`account-menu-item ${person.isActive ? 'danger' : ''}`} onClick={onStatusChange}>{person.isActive ? <UserRoundX size={17} /> : <UserRoundCheck size={17} />}<span>{person.isActive ? 'Deactivate account' : 'Activate account'}</span></Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
