import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, api } from './api';
import { InventoryProvider } from './app/inventory-store';
import { RoleWorkspace } from './app/role-workspace';
import { useAuth } from './auth-context';
import { StockLedgerMark } from './components/stockledger-mark';
import { LoginPage } from './features/auth/login-page';
import { ResetPasswordPage } from './features/auth/reset-password-page';
import { SignupPage } from './features/auth/signup-page';
import { LandingPage } from './features/marketing/landing-page';
import { OnboardingPage } from './features/onboarding/onboarding-page';
import type { OnboardingStatus } from './types';

export function App() {
  return <Routes>
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="*" element={<AuthenticatedApp />} />
  </Routes>;
}

function AuthenticatedApp() {
  const { accessToken, restoring, user } = useAuth();

  if (restoring || (accessToken && !user)) return <AppLoader />;

  if (!accessToken) {
    return <Routes>
      <Route index element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>;
  }

  if (user?.role === 'administrator') return <OwnerGate accessToken={accessToken} />;

  return <InventoryProvider><RoleWorkspace /></InventoryProvider>;
}

function OwnerGate({ accessToken }: { accessToken: string }) {
  const { signOut } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setStatus(await api.onboardingStatus(accessToken));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not load business setup');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void api.onboardingStatus(accessToken)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) signOut();
        else setError(caught instanceof Error ? caught.message : 'Could not load business setup');
      });
    return () => { cancelled = true; };
  }, [accessToken, signOut]);

  if (error) return <main className="gate-error"><div><StockLedgerMark size={36} /><h1>We could not open your workspace.</h1><p>{error}</p><button className="button" onClick={() => { setError(null); void load(); }} type="button">Try again</button></div></main>;
  if (!status) return <AppLoader />;

  if (!status.completed) {
    return <Routes>
      <Route path="/onboarding" element={<OnboardingPage initialStatus={status} onComplete={setStatus} />} />
      <Route path="*" element={<Navigate to="/onboarding" replace />} />
    </Routes>;
  }

  return <InventoryProvider><RoleWorkspace /></InventoryProvider>;
}

function AppLoader() {
  return <div className="app-loader" role="status">
    <span className="brand-mark"><StockLedgerMark animated size={48} /></span>
    <span className="sr-only">Restoring session</span>
  </div>;
}
