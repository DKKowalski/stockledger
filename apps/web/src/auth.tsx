import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { AuthContext } from './auth-context';
import type { LoginResponse, RegistrationResponse, User } from './types';

let refreshInFlight: Promise<LoginResponse> | null = null;

function refreshOnce() {
  refreshInFlight ??= api.refresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);

  const adoptSession = useCallback((session: LoginResponse) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setRestoring(false);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setRestoring(false);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    void api.logout().catch(() => undefined);
  }, [clearSession]);

  useEffect(() => {
    window.localStorage.removeItem('stockledger.accessToken');
    let cancelled = false;
    void refreshOnce()
      .then((session) => { if (!cancelled) adoptSession(session); })
      .catch(() => { if (!cancelled) clearSession(); });
    return () => { cancelled = true; };
  }, [adoptSession, clearSession]);

  useEffect(() => {
    if (!accessToken) return;
    const expiresAt = tokenExpiry(accessToken);
    const delay = Math.max(5_000, expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void refreshOnce().then(adoptSession).catch(signOut);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [accessToken, adoptSession, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    adoptSession(await api.login({ email, password }));
  }, [adoptSession]);

  const registerOwner = useCallback(async (body: { fullName: string; businessName: string; email: string; password: string }): Promise<RegistrationResponse> => {
    return api.registerOwner(body);
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    adoptSession(await api.verifyEmail(token));
  }, [adoptSession]);

  const acceptInvitation = useCallback(async (token: string, newPassword: string) => {
    adoptSession(await api.acceptInvitation(token, newPassword));
  }, [adoptSession]);

  const updateProfile = useCallback(async (body: { fullName: string; email: string }) => {
    if (!accessToken) throw new Error('Sign in to update your profile');
    const profile = await api.updateProfile(accessToken, body);
    setUser(profile);
    return profile;
  }, [accessToken]);

  const changePassword = useCallback(async (body: { currentPassword: string; newPassword: string }) => {
    if (!accessToken) throw new Error('Sign in to change your password');
    await api.changePassword(accessToken, body);
    clearSession();
  }, [accessToken, clearSession]);

  const value = useMemo(
    () => ({ accessToken, user, restoring, signIn, registerOwner, verifyEmail, acceptInvitation, signOut, updateProfile, changePassword }),
    [accessToken, user, restoring, signIn, registerOwner, verifyEmail, acceptInvitation, signOut, updateProfile, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function tokenExpiry(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/'))) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return Date.now() + 60_000;
  }
}
