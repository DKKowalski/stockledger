import { ArrowUpRight, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth-context';
import { StockLedgerMark } from '../../components/stockledger-mark';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = () => {
    setEmail('admin@stockledger.app');
    setPassword('StockLedger123!');
    setError(null);
  };

  return <main className="login-page">
    <section className="login-visual" aria-label="StockLedger product overview">
      <div className="login-image">
        <img alt="" aria-hidden="true" src="/images/login-warehouse.jpg" />
        <div className="login-brand"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</div>
        <div className="login-visual-copy"><h1>Every item accounted for.</h1><p>Know what came in, what went out, and what remains.</p></div>
      </div>
    </section>
    <section className="login-form-pane">
      <div className="mobile-login-brand"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</div>
      <div className="login-form-wrap">
        <div className="login-heading"><h2>Welcome back</h2><p>Sign in to open your inventory workspace.</p></div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          {error && <div className="login-error" role="alert">{error}</div>}
          <label><span>Email address</span><input autoComplete="email" inputMode="email" placeholder="you@company.com" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Password</span><span className="password-field">
            <input autoComplete="current-password" placeholder="Enter your password" required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span></label>
          <button className="button login-submit" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Signing in</> : <>Sign in<ArrowUpRight size={17} /></>}</button>
        </form>
        <button className="demo-login" type="button" onClick={useDemo}><span><b>Preview the demo workspace</b><small>Fill in the seeded administrator account</small></span><ChevronRight size={18} /></button>
      </div>
      <p className="login-footnote">Protected with encrypted passwords and expiring sessions.</p>
    </section>
  </main>;
}
