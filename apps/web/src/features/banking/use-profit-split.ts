import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { ProfitSplit } from './profit-split-types';

// One load of the month's split view, shared by the Stock capital and Profit split sections.
export function useProfitSplit(accessToken: string, month: string, onUnauthorized: () => void) {
  const [loaded, setLoaded] = useState<ProfitSplit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void api.profitSplit(accessToken, month).then(result => { if (active) { setLoaded(result); setError(null); } }).catch(caught => {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      else if (active) setError(safeErrorMessage(caught, 'Could not load the profit split'));
    });
    return () => { active = false; };
  }, [accessToken, month, refresh, onUnauthorized]);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  return { split: loaded?.month === month ? loaded : null, error, reload };
}
