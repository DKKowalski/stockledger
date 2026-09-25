import { ArrowLeft, ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { TallyMascot } from '../../components/tally-mascot';
import { InputControl } from '../../components/ui/input-control';

export function SignupPage() {
  const { registerOwner } = useAuth();
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await registerOwner({ fullName, businessName, email, password });
      setVerificationEmail(result.email);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create your workspace');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="signup-page">
    <section className="signup-story" aria-label="Meet Tally, your StockLedger setup guide">
      <Link className="signup-brand" to="/"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
      <div className="signup-mascot"><TallyMascot /></div>
      <div className="signup-story-copy"><span>Meet Tally</span><h1>Start with the stock you have today.</h1><p>Three quick choices after this and your workspace is ready.</p></div>
    </section>
    <section className="signup-form-pane">
      <Link className="signup-back" to="/login"><ArrowLeft size={15} />Back to sign in</Link>
      <div className="signup-form-wrap">
        {verificationEmail ? <div className="login-heading"><h2>Check your email</h2><p>We sent a verification link to <strong>{verificationEmail}</strong>. Open it to finish creating your workspace.</p><Link className="button login-submit" to="/login">Back to sign in</Link></div> : <>
        <div className="login-heading"><h2>Create your workspace</h2><p>Set up the owner account for your business.</p></div>
        <form className="login-form signup-form" onSubmit={(event) => void submit(event)}>
          {error && <div className="login-error" role="alert">{error}</div>}
          <div className="signup-name-grid">
            <label><span>Your name</span><InputControl autoComplete="name" placeholder="Ama Mensah" required value={fullName} onValueChange={setFullName} /></label>
            <label><span>Business name</span><InputControl autoComplete="organization" placeholder="Mensah Trading" required value={businessName} onValueChange={setBusinessName} /></label>
          </div>
          <label><span>Work email</span><InputControl autoComplete="email" inputMode="email" placeholder="you@company.com" required type="email" value={email} onValueChange={setEmail} /></label>
          <label><span>Password</span><span className="password-field">
            <InputControl autoComplete="new-password" minLength={8} placeholder="At least 8 characters" required type={showPassword ? 'text' : 'password'} value={password} onValueChange={setPassword} />
            <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span></label>
          <button className="button login-submit" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Creating workspace</> : <>Continue to setup<ArrowUpRight size={17} /></>}</button>
        </form>
        <p className="signup-signin">Already have an account? <Link to="/login">Sign in</Link></p>
        </>}
      </div>
    </section>
  </main>;
}
