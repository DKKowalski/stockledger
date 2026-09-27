import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';

type VerificationResendProps = {
  email?: string;
  editable?: boolean;
};

export function VerificationResend({ email = '', editable = false }: VerificationResendProps) {
  const [address, setAddress] = useState(email);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.resendVerification(address);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send another verification email');
    } finally {
      setSending(false);
    }
  };

  return <form className="verification-resend" onSubmit={(event) => void submit(event)}>
    {editable && <label><span>Email address</span><InputControl
      autoComplete="email"
      inputMode="email"
      onValueChange={(value) => { setAddress(value); setSent(false); setError(null); }}
      placeholder="you@company.com"
      required
      type="email"
      value={address}
    /></label>}
    {error && <div className="login-error" role="alert">{error}</div>}
    <button className="button secondary verification-resend-button" disabled={sending || sent || !address.trim()} type="submit">
      {sending ? <><StockLedgerMark animated size={18} />Sending link</> : sent ? 'Verification email sent' : 'Send another link'}
    </button>
    {sent && <p className="verification-resend-status" role="status">If this address is awaiting verification, a fresh link is on the way.</p>}
  </form>;
}
