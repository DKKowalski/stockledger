// Which navigation layout this device uses. Like appearance it is a personal, per-device choice
// kept in the browser; there is no user-preferences API to store it on the server.
import { useSyncExternalStore } from 'react';

export type NavLayout = 'header' | 'sidebar';
export const defaultNavLayout: NavLayout = 'header';

const layoutKey = 'stockledger.nav-layout.v1';
const collapsedKey = 'stockledger.nav-collapsed.v1';

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The choice still applies until the page reloads. */ }
}

const listeners = new Set<() => void>();
const memory: Record<string, string | undefined> = {};
function emit() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}
function stored(key: string) { return memory[key] ?? read(key); }
function set(key: string, value: string) { memory[key] = value; write(key, value); emit(); }

export function readNavLayout(): NavLayout { return stored(layoutKey) === 'sidebar' ? 'sidebar' : defaultNavLayout; }
export function saveNavLayout(layout: NavLayout) { set(layoutKey, layout); }
export function useNavLayout() { return useSyncExternalStore(subscribe, readNavLayout, () => defaultNavLayout); }

export function readSidebarCollapsed() { return stored(collapsedKey) === 'true'; }
export function saveSidebarCollapsed(collapsed: boolean) { set(collapsedKey, String(collapsed)); }
export function useSidebarCollapsed() { return useSyncExternalStore(subscribe, readSidebarCollapsed, () => false); }
