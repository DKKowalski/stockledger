import { ArrowUpRight, Check, Eye, EyeOff } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';

export function ResetPasswordPage() {
  const { signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [passwords, setPasswords] = useState({ next: '', confirm: '' });
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : 'This reset link is incomplete');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (passwords.next !== passwords.confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword({ token, newPassword: passwords.next });
      signOut();
      setComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset this password');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="reset-page">
    <Link className="mobile-login-brand reset-brand" to="/login"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
    <section className="reset-card">
      {complete ? <div className="reset-complete">
        <span><Check size={22} /></span>
        <h1>Password changed</h1>
        <p>Your new password is ready. You can now sign in to StockLedger.</p>
        <Link className="button login-submit" to="/login">Return to sign in<ArrowUpRight size={17} /></Link>
      </div> : <>
        <div className="login-heading"><h1>Choose a new password</h1><p>Use at least 8 characters. This reset link works once.</p></div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          {error && <div className="login-error" role="alert">{error}</div>}
          <ResetPasswordField label="New password" value={passwords.next} onValueChange={(next) => setPasswords({ ...passwords, next })} />
          <ResetPasswordField label="Confirm new password" value={passwords.confirm} onValueChange={(confirm) => setPasswords({ ...passwords, confirm })} />
          <button className="button login-submit" disabled={submitting || !token}>{submitting ? <><StockLedgerMark animated size={20} />Updating</> : <>Set new password<ArrowUpRight size={17} /></>}</button>
        </form>
      </>}
    </section>
  </main>;
}

function ResetPasswordField({ label, value, onValueChange }: { label: string; value: string; onValueChange: (value: string) => void }) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  return <label htmlFor={inputId}><span>{label}</span><span className="password-field">
    <InputControl id={inputId} autoComplete="new-password" minLength={8} maxLength={128} required type={visible ? 'text' : 'password'} value={value} onValueChange={onValueChange} />
    <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </span></label>;
}
