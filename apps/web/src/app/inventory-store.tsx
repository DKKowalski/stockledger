import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from '../api';
import { useAuth } from '../auth-context';
import type { Snapshot } from '../types';

type InventoryStore = {
  snapshot: Snapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  days: number;
  setDays: (days: number) => void;
  locationId: string | null;
  setLocationId: (locationId: string | null) => void;
  refresh: () => Promise<void>;
  notice: { id: number; title: string; message: string; visible: boolean } | null;
  dismissNotice: () => void;
  notify: (message: string, title?: string) => void;
  mutate: (action: () => Promise<unknown>, successMessage: string) => Promise<void>;
};

const InventoryStoreContext = createContext<InventoryStore | null>(null);

// Provider and hook belong together; consumers should not access the context directly.
// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryStore() {
  const store = useContext(InventoryStoreContext);
  if (!store) throw new Error('Missing inventory store');
  return store;
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const { accessToken, user, signOut } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [locationId, setLocationId] = useState<string | null>(user?.role === 'shop_attendant' ? user.locationId : null);
  const [notice, setNotice] = useState<InventoryStore['notice']>(null);
  const noticeId = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  if (!accessToken) throw new Error('InventoryProvider requires an authenticated session');

  const handleError = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof ApiError && caught.status === 401) signOut();
    setError(caught instanceof Error ? caught.message : fallback);
  }, [signOut]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await api.snapshot(accessToken, days, locationId));
    } catch (caught) {
      handleError(caught, 'Could not load inventory');
    } finally {
      setLoading(false);
    }
  }, [accessToken, days, locationId, handleError]);

  useEffect(() => {
    let cancelled = false;
    void api.snapshot(accessToken, days, locationId)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) handleError(caught, 'Could not load inventory');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [accessToken, days, locationId, handleError]);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice((current) => current ? { ...current, visible: false } : null);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 180);
  }, []);

  const notify = useCallback((message: string, title = 'Inventory updated') => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    const id = ++noticeId.current;
    setNotice({ id, title, message, visible: true });
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) => current?.id === id ? { ...current, visible: false } : current);
      noticeTimer.current = window.setTimeout(() => {
        setNotice((current) => current?.id === id ? null : current);
      }, 180);
    }, 3200);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  const mutate = useCallback(async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSnapshot(await api.snapshot(accessToken, days, locationId));
      notify(successMessage);
    } catch (caught) {
      handleError(caught, 'Request failed');
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [accessToken, days, locationId, handleError, notify]);

  const store = useMemo(
    () => ({ snapshot, loading, busy, error, days, setDays, locationId, setLocationId, refresh, notice, dismissNotice, notify, mutate }),
    [snapshot, loading, busy, error, days, locationId, refresh, notice, dismissNotice, notify, mutate],
  );

  return <InventoryStoreContext.Provider value={store}>{children}</InventoryStoreContext.Provider>;
}
