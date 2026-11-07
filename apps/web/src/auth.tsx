import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { AuthContext } from './auth-context';
import type { LoginResponse, RegistrationResponse, User } from './types';

const IDLE_AFTER_MS = 5 * 60_000;
const isHidden = () => document.visibilityState === 'hidden';
const SIGN_OUT_KEY = 'stockledger:sign-out';

// Tabs share a rotating HttpOnly cookie. Serialize requests so each request
// sends the cookie set by the previous response, without sharing bearer tokens.
function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('stockledger:session', action) : action();
}

let refreshInFlight: Promise<LoginResponse> | null = null;
class RefreshPaused extends Error {}

function refreshOnce(canRefresh: () => boolean) {
  refreshInFlight ??= withSessionLock(() => {
    // Recheck after waiting for another tab's cookie rotation.
    if (!canRefresh()) throw new RefreshPaused();
    return api.refresh();
  }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const [refreshState, setRefreshState] = useState<'active' | 'paused' | 'refreshing' | 'error'>('active');
  const activity = useRef({ lastActive: 0, paused: false, running: false, failed: false });
  const sessionEpoch = useRef(0);

  const adoptSession = useCallback((session: LoginResponse) => {
    if (!activity.current.lastActive) activity.current.lastActive = Date.now();
    activity.current.paused = false;
    activity.current.failed = false;
    setSessionVersion(version => version + 1);
    setAccessToken(session.accessToken);
    setUser(session.user);
    setRestoring(false);
    setRefreshState('active');
  }, []);

  const clearSession = useCallback(() => {
    sessionEpoch.current++;
    activity.current = { lastActive: 0, paused: false, running: false, failed: false };
    setAccessToken(null);
    setUser(null);
    setRestoring(false);
    setRefreshState('active');
  }, []);

  const clearEveryTab = useCallback(() => {
    clearSession();
    try { localStorage.setItem(SIGN_OUT_KEY, crypto.randomUUID()); } catch { /* Storage may be unavailable. */ }
  }, [clearSession]);

  const signOut = useCallback(() => {
    clearEveryTab();
    void withSessionLock(() => api.logout()).catch(() => undefined);
  }, [clearEveryTab]);

  useEffect(() => {
    const onSignOut = (event: StorageEvent) => {
      if (event.key === SIGN_OUT_KEY && event.newValue) clearSession();
    };
    window.addEventListener('storage', onSignOut);
    return () => window.removeEventListener('storage', onSignOut);
  }, [clearSession]);

  useEffect(() => {
    window.localStorage.removeItem('stockledger.accessToken');
    let cancelled = false, started = false;
    const epoch = sessionEpoch.current;
    let deferred: LoginResponse | null = null;
    const restore = () => {
      if (isHidden() || epoch !== sessionEpoch.current) return;
      if (deferred) {
        const session = deferred; deferred = null;
        if (tokenExpiry(session.accessToken) > Date.now() + 60_000) { adoptSession(session); return; }
        started = false;
      }
      if (started) return;
      started = true;
      activity.current.lastActive = Date.now();
      void refreshOnce(() => !isHidden() && epoch === sessionEpoch.current)
        .then((session) => {
          if (cancelled || epoch !== sessionEpoch.current) return;
          if (isHidden()) deferred = session;
          else adoptSession(session);
        })
        .catch(caught => {
          if (cancelled || epoch !== sessionEpoch.current) return;
          if (caught instanceof RefreshPaused) started = false;
          else if (caught instanceof ApiError && caught.status === 401) clearSession();
          else { activity.current.failed = true; setRestoring(false); setRefreshState('error'); }
        });
    };
    restore();
    document.addEventListener('visibilitychange', restore);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', restore); };
  }, [adoptSession, clearSession]);

  const resumeSession = useCallback(async () => {
    const current = activity.current;
    if (current.running || isHidden()) return;
    const epoch = sessionEpoch.current;
    current.lastActive = Date.now();
    current.running = true; current.paused = false; current.failed = false;
    setRefreshState('refreshing');
    try {
      const session = await refreshOnce(() => !isHidden() && Date.now() - current.lastActive < IDLE_AFTER_MS && epoch === sessionEpoch.current);
      if (epoch !== sessionEpoch.current) return;
      // Do not trigger workspace reads if the tab went away during the request.
      if (isHidden() || Date.now() - current.lastActive >= IDLE_AFTER_MS) {
        current.paused = true; setRefreshState('paused');
      } else adoptSession(session);
    } catch (caught) {
      if (epoch !== sessionEpoch.current) return;
      if (caught instanceof RefreshPaused) { current.paused = true; setRefreshState('paused'); }
      else if (caught instanceof ApiError && caught.status === 401) clearSession();
      else { current.failed = true; setRefreshState('error'); }
    } finally { current.running = false; }
  }, [adoptSession, clearSession]);

  useEffect(() => {
    if (!accessToken) return;
    const current = activity.current;
    let idleTimer: number | undefined, tokenTimer: number | undefined;
    const clearTimers = () => {
      window.clearTimeout(idleTimer); window.clearTimeout(tokenTimer);
      idleTimer = undefined; tokenTimer = undefined;
    };
    const pause = () => {
      clearTimers(); current.paused = true;
      if (!current.failed) setRefreshState('paused');
    };
    const arm = () => {
      window.clearTimeout(idleTimer);
      if (current.failed || current.running) { clearTimers(); return; }
      const remaining = IDLE_AFTER_MS - (Date.now() - current.lastActive);
      if (isHidden() || remaining <= 0) { pause(); return; }
      idleTimer = window.setTimeout(pause, remaining);
      tokenTimer ??= window.setTimeout(() => {
        tokenTimer = undefined;
        if (isHidden() || Date.now() - current.lastActive >= IDLE_AFTER_MS) pause();
        else void resumeSession();
      }, Math.max(5_000, tokenExpiry(accessToken) - Date.now() - 60_000));
    };
    const onActivity = () => {
      if (isHidden()) return;
      const needsResume = current.paused || Date.now() - current.lastActive >= IDLE_AFTER_MS;
      current.lastActive = Date.now();
      if (needsResume && !current.failed && !current.running) { clearTimers(); void resumeSession(); }
      else arm();
    };
    const onReturn = () => {
      if (isHidden()) pause();
      else if (current.paused || Date.now() - current.lastActive >= IDLE_AFTER_MS || tokenExpiry(accessToken) <= Date.now() + 60_000) onActivity();
    };
    // Queue initial scheduling outside React's effect setup. No network polling.
    const setup = window.setTimeout(arm, 0);
    // Scroll events also come from layout/focus changes; only wheel, touch,
    // keyboard and pointer input establish that someone is using the page.
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(event, onActivity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('pageshow', onReturn);
    return () => {
      window.clearTimeout(setup); clearTimers();
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.removeEventListener(event, onActivity, true);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn); window.removeEventListener('pageshow', onReturn);
    };
  }, [accessToken, sessionVersion, resumeSession]);

  const authenticate = useCallback(async (action: () => Promise<LoginResponse>) => {
    const epoch = ++sessionEpoch.current;
    activity.current = { lastActive: Date.now(), paused: false, running: false, failed: false };
    const session = await withSessionLock(action);
    if (epoch === sessionEpoch.current) adoptSession(session);
  }, [adoptSession]);

  const signIn = useCallback((email: string, password: string) => authenticate(() => api.login({ email, password })), [authenticate]);

  const registerOwner = useCallback(async (body: { fullName: string; businessName: string; email: string; password: string }): Promise<RegistrationResponse> => {
    return api.registerOwner(body);
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    await authenticate(() => api.verifyEmail(token));
  }, [authenticate]);

  const acceptInvitation = useCallback(async (token: string, newPassword: string) => {
    await authenticate(() => api.acceptInvitation(token, newPassword));
  }, [authenticate]);

  const updateProfile = useCallback(async (body: { fullName: string; email: string }) => {
    if (!accessToken) throw new Error('Sign in to update your profile');
    const profile = await api.updateProfile(accessToken, body);
    setUser(profile);
    return profile;
  }, [accessToken]);

  const changePassword = useCallback(async (body: { currentPassword: string; newPassword: string }) => {
    if (!accessToken) throw new Error('Sign in to change your password');
    await withSessionLock(() => api.changePassword(accessToken, body));
    clearEveryTab();
  }, [accessToken, clearEveryTab]);

  const value = useMemo(
    () => ({ accessToken, user, restoring, sessionVersion, refreshState, resumeSession, signIn, registerOwner, verifyEmail, acceptInvitation, signOut, updateProfile, changePassword }),
    [accessToken, user, restoring, sessionVersion, refreshState, resumeSession, signIn, registerOwner, verifyEmail, acceptInvitation, signOut, updateProfile, changePassword],
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
