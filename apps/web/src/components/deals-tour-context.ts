import { createContext, useContext } from 'react';

type TourValue = { start: () => void; dismiss: () => void; seen: boolean };

export const TourContext = createContext<TourValue>({ start: () => undefined, dismiss: () => undefined, seen: true });

export function useDealsTour() {
  return useContext(TourContext);
}

// Remembered per browser and person; if storage is unavailable the card simply shows again.
export const storageKey = (userId: string, name: string) => `stockledger.whats-new.${name}.v1:${userId}`;

export function readSeen(key: string) {
  try { return localStorage.getItem(key) === 'seen'; } catch { return false; }
}

export function markSeen(key: string) {
  try { localStorage.setItem(key, 'seen'); } catch { /* the card shows again next time */ }
}
