import { CircleX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth-context';
import { StockLedgerMark } from '../../components/stockledger-mark';

export function VerifyEmailPage() {
  const { verifyEmail } = useAuth();
  const [search] = useSearchParams();
  const token = search.get('token');
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(() => token ? null : 'This verification link is incomplete.');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) return;
    void verifyEmail(token)
      .then(() => navigate('/onboarding', { replace: true }))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not verify this email'));
  }, [navigate, token, verifyEmail]);

  return <AuthLinkPage
    error={error}
    pendingTitle="Verifying your email"
    pendingCopy="This should only take a moment."
  />;
}

function AuthLinkPage({ error, pendingTitle, pendingCopy }: { error: string | null; pendingTitle: string; pendingCopy: string }) {
  return <main className="reset-page"><section className="reset-card">
    <Link className="login-brand" to="/"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</Link>
    {error ? <div className="reset-success"><CircleX size={32} /><h1>Link not accepted</h1><p>{error}</p><Link className="button" to="/login">Back to sign in</Link></div>
      : <div className="reset-success"><StockLedgerMark animated size={36} /><h1>{pendingTitle}</h1><p>{pendingCopy}</p></div>}
  </section></main>;
}
