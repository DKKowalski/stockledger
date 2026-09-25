import { ArrowUpRight, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';

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

  const resendVerification = async () => {
    try {
      await api.resendVerification(email);
      toast.success('Verification email sent', { description: 'Check your inbox for a fresh link.' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send a verification email');
    }
  };

  return <main className="login-page">
    <section className="login-visual" aria-label="StockLedger product overview">
      <div className="login-image">
        <img alt="" aria-hidden="true" src="/images/login-warehouse.jpg" />
        <Link className="login-brand" to="/"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
        <div className="login-visual-copy"><h1>Every item accounted for.</h1><p>Know what came in, what went out, and what remains.</p></div>
      </div>
    </section>
    <section className="login-form-pane">
      <Link className="mobile-login-brand" to="/"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
      <div className="login-form-wrap">
        <div className="login-heading"><h2>Welcome back</h2><p>Sign in to open your inventory workspace.</p></div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          {error && <div className="login-error" role="alert">{error}{error.includes('Verify your email') && <button className="text-button" type="button" onClick={() => void resendVerification()}>Send another link</button>}</div>}
          <label><span>Email address</span><InputControl autoComplete="email" inputMode="email" placeholder="you@company.com" required type="email" value={email} onValueChange={setEmail} /></label>
          <label><span className="login-password-label"><span>Password</span><Link to="/forgot-password">Forgot password?</Link></span><span className="password-field">
            <InputControl autoComplete="current-password" placeholder="Enter your password" required type={showPassword ? 'text' : 'password'} value={password} onValueChange={setPassword} />
            <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span></label>
          <button className="button login-submit" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Signing in</> : <>Sign in<ArrowUpRight size={17} /></>}</button>
        </form>
        <button className="demo-login" type="button" onClick={useDemo}><span><b>Preview the demo workspace</b><small>Explore real sample data without changing it</small></span><ChevronRight size={18} /></button>
        <p className="signup-signin">New to StockLedger? <Link to="/signup">Create your workspace</Link></p>
      </div>
      <p className="login-footnote">Protected with encrypted passwords and expiring sessions.</p>
    </section>
  </main>;
}
