import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';

export function AcceptInvitationPage() {
  const { acceptInvitation } = useAuth();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [passwords, setPasswords] = useState({ next: '', confirm: '' });
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = search.get('token');
    if (!token) return setError('This invitation link is incomplete.');
    if (passwords.next !== passwords.confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvitation(token, passwords.next);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not accept this invitation');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="reset-page"><section className="reset-card">
    <Link className="login-brand" to="/"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
    <div className="login-heading"><h1>Set up your account</h1><p>Choose the password you will use to sign in.</p></div>
    <form className="login-form" onSubmit={(event) => void submit(event)}>
      {error && <div className="login-error" role="alert">{error}</div>}
      <label><span>New password</span><span className="password-field"><InputControl autoComplete="new-password" minLength={8} maxLength={128} required type={visible ? 'text' : 'password'} value={passwords.next} onValueChange={(next) => setPasswords({ ...passwords, next })} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
      <label><span>Confirm password</span><InputControl autoComplete="new-password" minLength={8} maxLength={128} required type={visible ? 'text' : 'password'} value={passwords.confirm} onValueChange={(confirm) => setPasswords({ ...passwords, confirm })} /></label>
      <button className="button login-submit" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Setting up</> : <>Join workspace<ArrowUpRight size={17} /></>}</button>
    </form>
  </section></main>;
}
