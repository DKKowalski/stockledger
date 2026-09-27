import { Dialog } from '@base-ui/react/dialog';
import { ArrowRightLeft, History, Laptop, LogOut, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, Panel } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { SelectControl } from '../../components/ui/select-control';
import type { SecurityOverview, User } from '../../types';
import { SettingsNavigation } from './settings-navigation';

export function SecuritySettingsPage() {
  const { accessToken, signOut } = useAuth();
  const { dateTime } = useCompanySettings();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const fetchOverview = useCallback(async () => {
    if (!accessToken) return null;
    const [security, team] = await Promise.all([api.securityOverview(accessToken), api.users(accessToken)]);
    return { security, team };
  }, [accessToken]);

  const load = useCallback(async () => {
    try {
      const result = await fetchOverview();
      if (!result) return;
      setOverview(result.security);
      setUsers(result.team);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not load security settings');
    }
  }, [fetchOverview, signOut]);

  useEffect(() => {
    let active = true;
    void fetchOverview().then((result) => {
      if (!active || !result) return;
      setOverview(result.security);
      setUsers(result.team);
      setError(null);
    }).catch((caught: unknown) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not load security settings');
    });
    return () => { active = false; };
  }, [fetchOverview, signOut]);

  const revoke = async (sessionId: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await api.revokeSession(accessToken, sessionId);
      toast.success('Session signed out');
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not sign out this session');
    } finally { setBusy(false); }
  };

  const revokeOthers = async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const result = await api.revokeOtherSessions(accessToken);
      toast.success(result.revoked ? `${result.revoked} other ${result.revoked === 1 ? 'session' : 'sessions'} signed out` : 'No other sessions were active');
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not sign out other sessions');
    } finally { setBusy(false); }
  };

  const eligibleOwners = useMemo(() => users.filter((user) => user.role !== 'administrator' && user.isActive && !user.setupPending), [users]);

  return <>
    <PageHeader title="Security and access" subtitle="Review active sessions, recent sign-ins, and workspace ownership." />
    <SettingsNavigation />
    {error && <div className="form-error settings-page-error" role="alert">{error}</div>}
    <div className="settings-content-column">
      <Panel title="Your active sessions" subtitle="A session stays signed in until it expires or you revoke it.">
        <div className="security-panel-actions"><button className="button secondary" disabled={busy || !overview?.sessions.some((session) => !session.current)} onClick={() => void revokeOthers()} type="button"><LogOut size={15} />Sign out other sessions</button></div>
        {!overview ? <div className="empty"><StockLedgerMark animated size={28} /><p>Checking sessions</p></div> : overview.sessions.length ? <div className="security-session-list">{overview.sessions.map((session) => {
          const device = deviceDetails(session.userAgent);
          return <article key={session.id} className="security-session-row">
            <span className="security-device-icon">{device.mobile ? <Smartphone size={18} /> : <Laptop size={18} />}</span>
            <div><h3>{device.label}{session.current && <span className="badge">This device</span>}</h3><p>{session.ipAddress || 'IP not available'} · Last used {dateTime(session.lastUsedAt)}</p></div>
            {!session.current && <button className="text-button danger" disabled={busy} onClick={() => void revoke(session.id)} type="button">Sign out</button>}
          </article>;
        })}</div> : <EmptyState text="No active sessions were found." />}
      </Panel>

      <Panel className="spaced" title="Recent sign-ins" subtitle="The latest successful sign-ins across your team.">
        {!overview ? <div className="empty"><p>Loading activity</p></div> : overview.recentSignIns.length ? <div className="security-signin-list">{overview.recentSignIns.map((signIn) => <article key={signIn.id}><span><History size={15} /></span><div><h3>{signIn.user?.fullName ?? 'Former team member'}</h3><p>{deviceDetails(signIn.userAgent).label} · {signIn.ipAddress || 'IP not available'}</p></div><time>{dateTime(signIn.createdAt)}</time></article>)}</div> : <EmptyState text="New sign-ins will appear here." />}
      </Panel>

      <Panel className="spaced danger-zone-panel" title="Transfer ownership" subtitle="Give administrator control to another active team member.">
        <div className="ownership-transfer-summary"><span><ShieldCheck size={19} /></span><div><h3>This changes who controls the workspace</h3><p>You become an inventory manager. Both accounts are signed out, and the new owner signs in with their existing password.</p></div><button className="button secondary" disabled={!eligibleOwners.length} onClick={() => setTransferOpen(true)} type="button"><ArrowRightLeft size={15} />Transfer ownership</button></div>
        {!eligibleOwners.length && <p className="settings-inline-note">Invite a team member and let them complete setup before transferring ownership.</p>}
      </Panel>
    </div>
    <OwnershipDialog open={transferOpen} users={eligibleOwners} onClose={() => setTransferOpen(false)} onTransferred={signOut} accessToken={accessToken} />
  </>;
}

function OwnershipDialog({ open, users, onClose, onTransferred, accessToken }: { open: boolean; users: User[]; onClose: () => void; onTransferred: () => void; accessToken: string | null }) {
  const [targetUserId, setTargetUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = users.find((user) => user.id === targetUserId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !target) return;
    setBusy(true); setError(null);
    try {
      await api.transferOwnership(accessToken, target.id, password);
      toast.success(`Ownership transferred to ${target.fullName}`);
      onTransferred();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not transfer ownership');
    } finally { setBusy(false); }
  };
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}><Dialog.Portal><Dialog.Backdrop className="team-share-backdrop" /><Dialog.Viewport className="team-share-viewport"><Dialog.Popup className="team-share-dialog ownership-dialog">
    <div className="team-share-heading"><span className="team-share-link-icon"><ArrowRightLeft size={18} /></span><div><Dialog.Title>Transfer ownership</Dialog.Title><Dialog.Description>This action takes effect immediately.</Dialog.Description></div><Dialog.Close className="team-share-dismiss" aria-label="Close"><X size={17} /></Dialog.Close></div>
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <label><span>New owner</span><SelectControl aria-label="New workspace owner" required value={targetUserId} onValueChange={setTargetUserId} options={[{ value: '', label: 'Choose a team member' }, ...users.map((user) => ({ value: user.id, label: `${user.fullName} · ${user.email}` }))]} /></label>
      <label><span>Your current password</span><InputControl autoComplete="current-password" required minLength={8} type="password" value={password} onValueChange={setPassword} /></label>
      <div className="ownership-warning">You will lose administrator access and be signed out.</div>
      <div className="dialog-actions"><Dialog.Close className="button secondary" disabled={busy}>Cancel</Dialog.Close><button className="button danger-button" disabled={busy || !target}>{busy ? 'Transferring' : 'Transfer ownership'}</button></div>
    </form>
  </Dialog.Popup></Dialog.Viewport></Dialog.Portal></Dialog.Root>;
}

function deviceDetails(userAgent: string | null) {
  if (!userAgent) return { label: 'Unknown device', mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const system = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'device';
  return { label: `${browser} on ${system}`, mobile };
}
