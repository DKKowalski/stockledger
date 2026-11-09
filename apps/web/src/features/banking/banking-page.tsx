import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import { useAuth } from '../../auth-context';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader, SelectControl } from '../../components/inventory-ui';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { companyDay } from '../../lib/date-range';
import { safeErrorMessage } from '../../lib/user-facing-error';
import { BankingCard } from './banking-card';
import { ProfitSplitSection } from './profit-split-section';
import { StockCapitalSection } from './stock-capital-section';
import { useProfitSplit } from './use-profit-split';
import type { BankedSummary } from './profit-split-types';

const monthName = (month: string) => new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));

export function BankingPage() {
  const { user } = useAuth();
  return <BankingWorkspace key={`${user?.companyId}:${user?.id}`} />;
}

function BankingWorkspace() {
  const { accessToken, user, signOut } = useAuth();
  const { settings } = useCompanySettings();
  const today = companyDay(settings?.timeZone);
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  // Open on the last completed month: that is the one whose profit is ready to bank.
  const [year, setYear] = useState(thisMonth === 1 ? thisYear - 1 : thisYear);
  const [monthNumber, setMonthNumber] = useState(String(thisMonth === 1 ? 12 : thisMonth - 1).padStart(2, '0'));
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const month = `${year}-${monthNumber}`;
  const onChanged = useCallback(() => setRevision(value => value + 1), []);
  const { split, error, reload } = useProfitSplit(accessToken ?? '', month, signOut);
  if (!accessToken) return null;
  return <div className="banking-page">
    <div className="finance-controls">
      <PageHeader title="Banking" subtitle="Bank the stock capital, split each month's net profit and record what you've banked." />
      <section className="panel finance-toolbar" aria-label="Banking filters">
        <label><span>Year</span><SelectControl aria-label="Banking year" value={String(year)} onValueChange={value => setYear(Number(value))} options={Array.from({ length: 8 }, (_, i) => String(thisYear + 1 - i)).map(value => ({ value, label: value }))} /></label>
        <label><span>Month</span><SelectControl aria-label="Banking month" value={monthNumber} onValueChange={setMonthNumber} options={Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => ({ value, label: monthName(`${year}-${value}`) }))} /></label>
        <div className="finance-editor-buttons"><Button type="button" variant="outline" className="h-[42px] px-4 text-[13px]" aria-expanded={editing} onClick={() => setEditing(value => !value)}>Split settings</Button></div>
      </section>
    </div>
    <BankedSummaryPanel accessToken={accessToken} year={year} revision={revision} onUnauthorized={signOut} />
    <StockCapitalSection accessToken={accessToken} month={month} split={split} readOnly={Boolean(user?.isDemo)} onChanged={onChanged} reload={reload} />
    <ProfitSplitSection accessToken={accessToken} month={month} monthLabel={`${monthName(month)} ${year}`} split={split} error={error} reload={reload} readOnly={Boolean(user?.isDemo)} editing={editing} onCloseEditor={() => setEditing(false)} onChanged={onChanged} />
  </div>;
}

function BankedSummaryPanel({ accessToken, year, revision, onUnauthorized }: { accessToken: string; year: number; revision: number; onUnauthorized: () => void }) {
  const { money } = useCompanySettings();
  const [loaded, setLoaded] = useState<BankedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void api.profitSplitSummary(accessToken, year).then(result => { if (active) { setLoaded(result); setError(null); } }).catch(caught => {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      else if (active) setError(safeErrorMessage(caught, 'Could not load what you have banked'));
    });
    return () => { active = false; };
  }, [accessToken, year, revision, retry, onUnauthorized]);
  const title = `Banked in ${year}`;
  if (error) return <BankingCard className="banking-summary mb-4" title={title}><Alert variant="destructive"><AlertDescription>{error}</AlertDescription><div className="mt-2"><Button type="button" variant="outline" className="h-11 px-4" onClick={() => setRetry(value => value + 1)}>Retry</Button></div></Alert></BankingCard>;
  if (!loaded || loaded.year !== year) return <BankingCard className="banking-summary mb-4" title={title}><p className="text-sm text-muted-foreground" role="status">Loading what you have banked</p></BankingCard>;
  const nothing = loaded.accounts.length === 0 && loaded.capital.count === 0;
  const times = (count: number) => `${count} ${count === 1 ? 'time' : 'times'}`;
  const row = (key: string, name: string, detail: string, amountCents: number, testId?: string) => <li key={key} data-testid={testId} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
    <div className="grid min-w-0 gap-0.5"><b className="text-sm [overflow-wrap:anywhere]">{name}</b><span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</span></div>
    <strong className="shrink-0 text-base tabular-nums">{money(amountCents)}</strong>
  </li>;
  return <BankingCard className="banking-summary mb-4" title={title} description="Everything ticked Done for this year's months: stock capital and profit parts.">
    {nothing ? <p className="text-sm text-muted-foreground" role="status">Nothing banked yet in {year}. Tick a part as Done once you&apos;ve moved the money.</p> : <>
      <ul className="grid gap-2">
        {loaded.capital.count > 0 && row('stock-capital', loaded.capital.destination, `${loaded.capital.partName} · ${times(loaded.capital.count)}`, loaded.capital.amountCents, 'banked-capital')}
        {loaded.accounts.map(account => row(account.destination, account.destination, `${account.partNames.join(', ')} · ${times(account.count)}`, account.amountCents))}
      </ul>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        <div className="flex justify-between gap-2"><dt>Capital banked</dt><dd className="font-semibold tabular-nums text-foreground" data-testid="capital-banked">{money(loaded.capitalCents)}</dd></div>
        <div className="flex justify-between gap-2"><dt>Profit banked</dt><dd className="font-semibold tabular-nums text-foreground" data-testid="profit-banked">{money(loaded.profitCents)}</dd></div>
      </dl>
      <Separator />
      <p className="profit-split-total flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">Total banked <strong className="text-xl tabular-nums text-foreground">{money(loaded.grandTotalCents)}</strong></p>
    </>}
  </BankingCard>;
}
