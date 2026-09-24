import { ArrowUpRight, CalendarDays, Eye, EyeOff, KeyRound, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import { PageHeader, Panel } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { UserAvatar } from '../../components/user-avatar';
import { joinedOn, roleLabel } from '../../lib/presentation';

export function AccountSettingsPage() {
  const { user, updateProfile, changePassword, signOut } = useAuth();
  const { notify, snapshot } = useInventoryStore();
  const [profile, setProfile] = useState({ fullName: user?.fullName ?? '', email: user?.email ?? '' });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) return null;

  const assignedPlace = snapshot?.locations.find((place) => place.id === user.locationId)?.name ?? 'All places';
  const profileChanged = profile.fullName.trim() !== user.fullName || profile.email.trim().toLowerCase() !== user.email;

  const submitProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      const saved = await updateProfile(profile);
      setProfile({ fullName: saved.fullName, email: saved.email });
      notify('Your name and email were saved.', 'Profile updated');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setProfileError(caught instanceof Error ? caught.message : 'Could not update your profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (passwords.next !== passwords.confirm) {
      setPasswordError('New passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword({ currentPassword: passwords.current, newPassword: passwords.next });
      setPasswords({ current: '', next: '', confirm: '' });
      notify('Use your new password the next time you sign in.', 'Password changed');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setPasswordError(caught instanceof Error ? caught.message : 'Could not change your password');
    } finally {
      setSavingPassword(false);
    }
  };

  return <>
    <PageHeader title="Account settings" subtitle="Your profile, access, and sign-in security." />
    <div className="account-settings-layout">
      <aside className="panel account-summary">
        <div className="account-identity">
          <UserAvatar name={user.fullName} size="large" />
          <div><h2>{user.fullName}</h2><p>{user.email}</p></div>
        </div>
        <dl className="account-facts">
          <div><dt><UserRound size={15} />Role</dt><dd>{roleLabel[user.role]}</dd></div>
          <div><dt><MapPin size={15} />Stock access</dt><dd>{assignedPlace}</dd></div>
          <div><dt><CalendarDays size={15} />Member since</dt><dd>{joinedOn(user.createdAt)}</dd></div>
        </dl>
        <p className="account-access-note"><ShieldCheck size={16} />An administrator manages roles and shop assignments.</p>
      </aside>

      <div className="account-settings-forms">
        <Panel title="Personal details" subtitle="Shown in StockLedger and used when you sign in.">
          <form className="account-form" onSubmit={(event) => void submitProfile(event)}>
            {profileError && <div className="form-error" role="alert">{profileError}</div>}
            <div className="account-form-fields">
              <label><span>Full name</span><InputControl autoComplete="name" required maxLength={120} value={profile.fullName} onValueChange={(fullName) => setProfile({ ...profile, fullName })} /></label>
              <label><span>Email address</span><InputControl autoComplete="email" inputMode="email" required type="email" maxLength={255} value={profile.email} onValueChange={(email) => setProfile({ ...profile, email })} /></label>
            </div>
            <div className="account-form-actions"><button className="button" disabled={savingProfile || !profileChanged}>{savingProfile ? <><StockLedgerMark animated size={20} />Saving</> : <>Save changes<ArrowUpRight size={16} /></>}</button></div>
          </form>
        </Panel>

        {user.role === 'administrator' ? <Panel title="Password" subtitle="Confirm your current password before choosing a new one." className="spaced">
          <form className="account-form" onSubmit={(event) => void submitPassword(event)}>
            {passwordError && <div className="form-error" role="alert">{passwordError}</div>}
            <div className="account-password-fields">
              <PasswordField label="Current password" autoComplete="current-password" value={passwords.current} onValueChange={(current) => setPasswords({ ...passwords, current })} />
              <PasswordField label="New password" autoComplete="new-password" minLength={8} value={passwords.next} onValueChange={(next) => setPasswords({ ...passwords, next })} />
              <PasswordField label="Confirm new password" autoComplete="new-password" minLength={8} value={passwords.confirm} onValueChange={(confirm) => setPasswords({ ...passwords, confirm })} />
            </div>
            <div className="account-form-actions"><span className="password-requirement"><KeyRound size={14} />At least 8 characters</span><button className="button" disabled={savingPassword}>{savingPassword ? <><StockLedgerMark animated size={20} />Updating</> : <>Update password<ArrowUpRight size={16} /></>}</button></div>
          </form>
        </Panel> : <Panel title="Sign-in security" subtitle="Your administrator manages password recovery." className="spaced">
          <div className="managed-security-note"><ShieldCheck size={22} /><div><h3>Need a new password?</h3><p>Ask your administrator to send a secure reset link to {user.email}. The link expires after 30 minutes.</p></div></div>
        </Panel>}
      </div>
    </div>
  </>;
}

function PasswordField({ label, autoComplete, minLength, value, onValueChange }: {
  label: string;
  autoComplete: string;
  minLength?: number;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  return <div className="account-password-field"><label htmlFor={inputId}>{label}</label><span className="password-field">
    <InputControl id={inputId} autoComplete={autoComplete} maxLength={128} minLength={minLength} required type={visible ? 'text' : 'password'} value={value} onValueChange={onValueChange} />
    <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  </span></div>;
}
