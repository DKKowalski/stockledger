import { ArrowLeft, ArrowUpRight, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request a reset link');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="reset-page">
    <Link className="mobile-login-brand reset-brand" to="/"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
    <section className="reset-card">
      {sent ? <div className="reset-complete">
        <span><MailCheck size={21} /></span>
        <h1>Check your inbox</h1>
        <p>If {email} belongs to a business owner account, we sent a password reset link. It expires after 30 minutes.</p>
        <Link className="button login-submit" to="/login">Back to sign in<ArrowUpRight size={17} /></Link>
      </div> : <>
        <Link className="auth-back-link" to="/login"><ArrowLeft size={15} />Back to sign in</Link>
        <div className="login-heading"><h1>Reset your password</h1><p>Enter the email used to create your business workspace.</p></div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          {error && <div className="login-error" role="alert">{error}</div>}
          <label><span>Email address</span><InputControl autoComplete="email" inputMode="email" placeholder="you@company.com" required type="email" value={email} onValueChange={setEmail} /></label>
          <button className="button login-submit" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Sending</> : <>Send reset link<ArrowUpRight size={17} /></>}</button>
        </form>
        <p className="reset-staff-note">Staff password resets are sent by the business administrator.</p>
      </>}
    </section>
  </main>;
}
