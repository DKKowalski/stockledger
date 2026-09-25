import { useCallback, useEffect, useRef, useState } from 'react';
import type { AsyncActionState } from './async-action-button';

export function useAsyncActionState(successDuration = 900) {
  const [state, setState] = useState<AsyncActionState>('idle');
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const run = useCallback(async <Result,>(action: () => Promise<Result>) => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    setState('pending');

    try {
      const result = await action();
      setState('success');
      resetTimer.current = window.setTimeout(() => {
        setState('idle');
        resetTimer.current = null;
      }, successDuration);
      return result;
    } catch (error) {
      setState('idle');
      throw error;
    }
  }, [successDuration]);

  return { state, run };
}
