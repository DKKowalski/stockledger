import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';
import { formatMoney } from '../lib/presentation';
import type { CompanyProfileSettings, CompanySettings, InventorySettings, TerminologySettings } from '../types';

type CompanySettingsStore = {
  settings: CompanySettings | null;
  loading: boolean;
  error: string | null;
  save: (settings: CompanyProfileSettings) => Promise<CompanySettings>;
  saveInventory: (settings: InventorySettings) => Promise<CompanySettings>;
  saveTerminology: (settings: TerminologySettings) => Promise<CompanySettings>;
  money: (cents: number) => string;
  calendarDate: (value: string) => string;
  memberDate: (value: string) => string;
  dateTime: (value: string) => string;
  terms: { item: string; items: string; Item: string; Items: string; shop: string; shops: string; Shop: string; Shops: string; warehouse: string; warehouses: string; Warehouse: string; Warehouses: string };
};

const CompanySettingsContext = createContext<CompanySettingsStore | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useCompanySettings() {
  const store = useContext(CompanySettingsContext);
  if (!store) throw new Error('Missing company settings store');
  return store;
}

export function CompanySettingsProvider({ children }: { children: ReactNode }) {
  const { accessToken, signOut } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!accessToken) throw new Error('CompanySettingsProvider requires an authenticated session');

  useEffect(() => {
    let cancelled = false;
    void api.companySettings(accessToken)
      .then((result) => {
        if (!cancelled) {
          setSettings(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) signOut();
        else setError(caught instanceof Error ? caught.message : 'Could not load business settings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [accessToken, signOut]);

  const save = useCallback(async (next: CompanyProfileSettings) => {
    const saved = await api.updateCompanySettings(accessToken, next);
    setSettings(saved);
    setError(null);
    return saved;
  }, [accessToken]);

  const saveInventory = useCallback(async (next: InventorySettings) => {
    const saved = await api.updateInventorySettings(accessToken, next);
    setSettings(saved);
    return saved;
  }, [accessToken]);

  const saveTerminology = useCallback(async (next: TerminologySettings) => {
    const saved = await api.updateTerminologySettings(accessToken, next);
    setSettings(saved);
    return saved;
  }, [accessToken]);

  const money = useCallback((cents: number) => {
    const currency = settings?.currency ?? 'GHS';
    return formatMoney(cents, currency);
  }, [settings?.currency]);

  const calendarDate = useCallback((value: string) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (settings?.dateFormat === 'year_month_day') return value;
    return new Intl.DateTimeFormat(settings?.dateFormat === 'month_day_year' ? 'en-US' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }, [settings?.dateFormat]);

  const memberDate = useCallback((value: string) => {
    const date = new Date(value);
    const timeZone = settings?.timeZone ?? 'Africa/Accra';
    if (settings?.dateFormat === 'year_month_day') {
      const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(date);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    }
    return new Intl.DateTimeFormat(settings?.dateFormat === 'month_day_year' ? 'en-US' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(date);
  }, [settings?.dateFormat, settings?.timeZone]);

  const dateTime = useCallback((value: string) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: settings?.timeZone ?? 'Africa/Accra',
  }).format(new Date(value)), [settings?.timeZone]);

  const terms = useMemo(() => {
    const item = settings?.itemTerm ?? 'item';
    const shop = settings?.shopTerm ?? 'shop';
    const warehouse = settings?.warehouseTerm ?? 'warehouse';
    const plural = (value: string) => value === 'branch' ? 'branches' : `${value}s`;
    const cap = (value: string) => value[0]!.toUpperCase() + value.slice(1);
    return { item, items: plural(item), Item: cap(item), Items: cap(plural(item)), shop, shops: plural(shop), Shop: cap(shop), Shops: cap(plural(shop)), warehouse, warehouses: plural(warehouse), Warehouse: cap(warehouse), Warehouses: cap(plural(warehouse)) };
  }, [settings?.itemTerm, settings?.shopTerm, settings?.warehouseTerm]);

  const store = useMemo(() => ({ settings, loading, error, save, saveInventory, saveTerminology, money, calendarDate, memberDate, dateTime, terms }), [settings, loading, error, save, saveInventory, saveTerminology, money, calendarDate, memberDate, dateTime, terms]);
  return <CompanySettingsContext.Provider value={store}>{children}</CompanySettingsContext.Provider>;
}
