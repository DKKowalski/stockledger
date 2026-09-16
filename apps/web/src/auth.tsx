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

  const value = useMemo(
    () => ({ accessToken, user, restoring, signIn, signOut }),
    [accessToken, user, restoring, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
