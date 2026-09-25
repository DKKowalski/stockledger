import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, api } from '../api';
import { useAuth } from '../auth-context';
import type { Snapshot } from '../types';
import { safeErrorMessage } from '../lib/user-facing-error';

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

  if (!accessToken) throw new Error('InventoryProvider requires an authenticated session');

  const handleError = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof ApiError && caught.status === 401) signOut();
    setError(safeErrorMessage(caught, fallback));
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

  const mutate = useCallback(async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSnapshot(await api.snapshot(accessToken, days, locationId));
      toast.success('Inventory updated', { description: successMessage });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        toast.error('Session expired', { description: 'Sign in again to continue.' });
        signOut();
      } else {
        toast.error('Could not update inventory', { description: safeErrorMessage(caught, 'The inventory could not be updated. Try again.') });
      }
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [accessToken, days, locationId, signOut]);

  const store = useMemo(
    () => ({ snapshot, loading, busy, error, days, setDays, locationId, setLocationId, refresh, mutate }),
    [snapshot, loading, busy, error, days, locationId, refresh, mutate],
  );

  return <InventoryStoreContext.Provider value={store}>{children}</InventoryStoreContext.Provider>;
}
