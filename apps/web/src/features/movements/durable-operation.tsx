import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { safeErrorMessage } from '../../lib/user-facing-error';
export type OperationRecord = {
  request: {
    key: string;
    status: 'prepared' | 'applied' | 'cancelled';
    input: Record<string, unknown> | null;
    preview?: {
      refundCents: number;
      cogsCents: number;
      currency: string;
      allocations: Array<{ itemId: string; quantity: number; refundCents: number; disposition: string }>;
    };
  } | null;
  result?: { refundCents: number; refundStatus: string } | null;
};
// Shared requests keep financial payloads on the server; only a UUID survives reload.
// eslint-disable-next-line react-refresh/only-export-components
export function useDurableOperation(kind: 'return' | 'stock') {
  const { user, accessToken } = useAuth();
  const { refresh } = useInventoryStore();
  const storageKey =
    kind === 'stock'
      ? `stockledger:exact-cost-request:${user!.companyId}:${user!.id}`
      : `stockledger:return-request:${user!.companyId}:${user!.id}`;
  const lock =
    kind === 'stock'
      ? `stockledger:exact-cost:${user!.companyId}:${user!.id}`
      : `stockledger:return:${user!.companyId}:${user!.id}`;
  const [key, setKey] = useState<string | null>(null),
    [record, setRecord] = useState<OperationRecord | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [generation, setGeneration] = useState(0);
  const running = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const load = () => {
      try {
        const next = localStorage.getItem(storageKey);
        if (next && !/^[a-f0-9-]{36}$/.test(next))
          throw new Error('The pending request cannot be read. Keep browser data and contact support.');
        setKey(next);
        setRecord(null);
        setGeneration((n) => n + 1);
      } catch (e) {
        setError(safeErrorMessage(e, 'Request recovery is unavailable.'));
      }
    };
    load();
    const listener = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) load();
    };
    window.addEventListener('storage', listener);
    return () => {
      alive.current = false;
      window.removeEventListener('storage', listener);
    };
  }, [storageKey]);
  const lookup = (requestKey: string) =>
    kind === 'return'
      ? api.returnRequest(accessToken!, requestKey)
      : (api.exactCostRequest(accessToken!, requestKey) as unknown as Promise<OperationRecord>);
  useEffect(() => {
    let active = true;
    if (key && accessToken)
      void (
        kind === 'return'
          ? api.returnRequest(accessToken, key)
          : (api.exactCostRequest(accessToken, key) as unknown as Promise<OperationRecord>)
      )
        .then((next) => {
          if (active)
            setRecord((previous) =>
              previous?.request?.key === key && (previous.request.status !== 'prepared' || !next.request)
                ? previous
                : next,
            );
        })
        .catch((e) => {
          if (active) setError(safeErrorMessage(e, 'Could not recover this request.'));
        });
    return () => {
      active = false;
    };
  }, [key, accessToken, kind]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.locks) throw new Error('Use a browser that supports safe request coordination.');
      await navigator.locks.request(lock, async () => {
        if (alive.current) await action();
      });
    } catch (e) {
      if (alive.current) setError(safeErrorMessage(e, 'Check the request status before continuing.'));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const start = (input: Record<string, unknown>) =>
    run(async () => {
      if (!accessToken) return;
      if (localStorage.getItem(storageKey)) {
        setKey(localStorage.getItem(storageKey));
        throw new Error('Resolve the pending request before starting another.');
      }
      const next = crypto.randomUUID();
      localStorage.setItem(storageKey, next);
      setKey(next);
      setRecord(null);
      const prepared =
        kind === 'return'
          ? await api.prepareReturn(accessToken, next, input)
          : ((await api.prepareExactCost(accessToken, next, input as never)) as unknown as OperationRecord);
      if (alive.current) setRecord(prepared);
    });
  const resolve = (action: 'apply' | 'cancel' | 'check' | 'continue') =>
    run(async () => {
      const requestKey = localStorage.getItem(storageKey);
      if (!accessToken || !requestKey || requestKey !== key)
        throw new Error('This request changed in another tab. Reload its status.');
      let next: OperationRecord;
      if (action === 'apply')
        next =
          kind === 'return'
            ? await api.applyReturn(accessToken, requestKey)
            : ((await api.applyExactCost(accessToken, requestKey)) as unknown as OperationRecord);
      else if (action === 'cancel')
        next =
          kind === 'return'
            ? await api.cancelReturn(accessToken, requestKey)
            : ((await api.cancelExactCost(accessToken, requestKey)) as unknown as OperationRecord);
      else next = await lookup(requestKey);
      if (!alive.current) return;
      setRecord(next);
      if (action === 'continue') {
        if (!next.request || next.request.status === 'prepared')
          throw new Error('Confirm or cancel this request before continuing.');
        if (localStorage.getItem(storageKey) === requestKey) localStorage.removeItem(storageKey);
        setKey(null);
        setRecord(null);
        setGeneration((n) => n + 1);
      }
      if (action !== 'check') await refresh();
    });
  return { key, record, error, busy, start, resolve, generation };
}
export function OperationButtons({
  operation,
  canApply = true,
}: {
  operation: ReturnType<typeof useDurableOperation>;
  canApply?: boolean;
}) {
  const status = operation.record?.request?.status;
  return (
    <div className="form-actions">
      {status === 'prepared' && canApply && (
        <button
          type="button"
          className="button"
          disabled={operation.busy}
          onClick={() => void operation.resolve('apply')}
        >
          Confirm record
        </button>
      )}
      {(!status || status === 'prepared') && (
        <>
          <button
            type="button"
            className="button secondary"
            disabled={operation.busy}
            onClick={() => void operation.resolve('check')}
          >
            Check request status
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={operation.busy}
            onClick={() => void operation.resolve('cancel')}
          >
            Cancel request
          </button>
        </>
      )}
      {status && status !== 'prepared' && (
        <button
          type="button"
          className="button secondary"
          disabled={operation.busy}
          onClick={() => void operation.resolve('continue')}
        >
          Continue
        </button>
      )}
    </div>
  );
}
