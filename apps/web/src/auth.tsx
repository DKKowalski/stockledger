import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { AuthContext } from './auth-context';
import type { LoginResponse, User } from './types';

const TOKEN_KEY = 'stockledger.accessToken';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(Boolean(accessToken));

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAccessToken(null);
    setUser(null);
    setRestoring(false);
  }, []);

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    void api.profile(accessToken)
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch(() => {
        if (!cancelled) signOut();
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => { cancelled = true; };
  }, [accessToken, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session: LoginResponse = await api.login({ email, password });
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const registerOwner = useCallback(async (body: { fullName: string; businessName: string; email: string; password: string }) => {
    const session: LoginResponse = await api.registerOwner(body);
    localStorage.setItem(TOKEN_KEY, session.accessToken);
    setAccessToken(session.accessToken);
    setUser(session.user);
    setRestoring(false);
  }, []);

  const updateProfile = useCallback(async (body: { fullName: string; email: string }) => {
    if (!accessToken) throw new Error('Sign in to update your profile');
    const profile = await api.updateProfile(accessToken, body);
    setUser(profile);
    return profile;
  }, [accessToken]);

  const changePassword = useCallback(async (body: { currentPassword: string; newPassword: string }) => {
    if (!accessToken) throw new Error('Sign in to change your password');
    await api.changePassword(accessToken, body);
  }, [accessToken]);

  const value = useMemo(
    () => ({ accessToken, user, restoring, signIn, registerOwner, signOut, updateProfile, changePassword }),
    [accessToken, user, restoring, signIn, registerOwner, signOut, updateProfile, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
