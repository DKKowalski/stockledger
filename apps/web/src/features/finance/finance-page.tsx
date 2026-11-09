import { DatePicker } from '../../components/ui/date-picker';
import { CircleAlert, Download, Printer } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, api } from '../../api';
import { useAuth } from '../../auth-context';
import { useCompanySettings } from '../../app/company-settings-store';
import { EmptyState, PageHeader, Panel, SelectControl } from '../../components/inventory-ui';
import { DateRangePicker } from '../../components/ui/date-range-picker';
import { InputControl } from '../../components/ui/input-control';
import { MotionTabs } from '../../components/ui/motion-tabs';
import { companyDay, rangeQuery, type DateRangeValue } from '../../lib/date-range';
import { parseMoneyCents } from '../../lib/presentation';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { FinanceBudgetInput, FinanceCategory, FinanceEntry, FinanceEntryInput, FinanceEntryList, FinanceLine, FinanceMonth, FinancePeriod, FinanceReport, FinanceStatus } from './finance-types';

type View = 'month' | 'months' | 'year';
type Editor = 'budget' | 'entries' | 'categories' | null;
type Metric = 'actual' | 'budget' | 'variance';

// Drafts belong to this signed-in Finance page, not an editor's mount lifetime.
// Nothing is persisted to shared-device storage. Period keys keep budgets separate.
type Drafts = Record<string, unknown>;
const DraftContext = createContext<{ drafts: Drafts; setDrafts: Dispatch<SetStateAction<Drafts>> } | null>(null);
function useFinanceDraft<T,>(key: string, initial: T) {
  const { drafts, setDrafts } = useContext(DraftContext)!;
  const value = key in drafts ? drafts[key] as T : initial;
  const setValue = (next: SetStateAction<T>) => setDrafts(current => ({ ...current, [key]: typeof next === 'function' ? (next as (value: T) => T)(key in current ? current[key] as T : initial) : next }));
  const clear = () => setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
  return [value, setValue, clear, key in drafts] as const;
}

const views = [{ value: 'month', label: 'Month' }, { value: 'months', label: 'All months' }, { value: 'year', label: 'Yearly' }] as const;
const monthName = (month: string, format: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(undefined, { month: format, timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
const lineOf = (period: FinancePeriod, key: string) => period.lines.find(line => line.key === key)!;
const varianceTone = (cents: number) => (cents < 0 ? 'negative' : cents > 0 ? 'positive' : '');
// The month tables drop the currency symbol to stay readable; the statement header names the currency.
const plainAmount = (cents: number) => (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FinancePage() {
  const { user } = useAuth();
  return <FinanceWorkspacePage key={`${user?.companyId}:${user?.id}`} />;
}

function FinanceWorkspacePage() {
  const { accessToken, user, signOut } = useAuth();
  const { settings, calendarDate } = useCompanySettings();
  const today = companyDay(settings?.timeZone);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [monthNumber, setMonthNumber] = useState(today.slice(5, 7));
  const [view, setView] = useState<View>('month');
  const [editor, setEditor] = useState<Editor>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reportRetry, setReportRetry] = useState(0);
  const [reportUpdated, setReportUpdated] = useState<Date | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const month = `${year}-${monthNumber}`;
  const readOnly = Boolean(user?.isDemo);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void api.finance(accessToken, year).then(result => { if (active) { setReport(result); setReportUpdated(new Date()); setError(null); } }).catch(caught => {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else if (active) setError(safeErrorMessage(caught, 'Could not load finance report'));
    }).finally(() => { if (active) setReportLoading(false); });
    return () => { active = false; };
  }, [accessToken, year, revision, reportRetry, signOut]);

  const save = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); setRevision(value => value + 1); toast.success('Finance records saved'); }
    catch (caught) { toast.error(safeErrorMessage(caught, 'Could not save finance records')); throw caught; }
    finally { setBusy(false); }
  }, []);

  const loaded = report?.year === year ? report : null;
  const selectedMonth = loaded?.months.find(period => period.month === month);
  const period = view === 'year' ? loaded?.yearly : selectedMonth;
  const hasBudget = view === 'month' ? selectedMonth?.hasBudget : loaded?.yearly.hasBudget;
  const coverageSource = view === 'month' ? selectedMonth : loaded?.yearly;
  const headerPeriod = view === 'month' ? selectedMonth : loaded?.yearly;
  const span = (from: string, to: string) => {
    const end = calendarDate(to);
    if (settings?.dateFormat !== 'day_month_year') return `${calendarDate(from)} to ${end}`;
    return `${from.slice(0, 7) === to.slice(0, 7) ? Number(from.slice(8)) : calendarDate(from).replace(/ \d{4}$/, '')} to ${end}`;
  };
  const periodLabel = !headerPeriod ? '' : headerPeriod.status === 'complete' ? `For the ${view === 'month' ? 'month' : 'year'} ended ${calendarDate(headerPeriod.to)}`
    : headerPeriod.status === 'future' ? `${view === 'month' ? `${monthName(month)} ${year}` : year} has not started`
      : `${view === 'month' ? 'Month' : 'Year'} to date, ${span(headerPeriod.from, headerPeriod.actualsTo!)}`;

  const exportFile = async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const file = await api.financeExport(accessToken, year, view, month);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); URL.revokeObjectURL(url);
    } catch (caught) { toast.error(safeErrorMessage(caught, 'Could not export report')); }
    finally { setBusy(false); }
  };
  const toggle = (next: Exclude<Editor, null>) => setEditor(editor === next ? null : next);
  const editorButton = (name: Exclude<Editor, null>, label: string) => <button className={`button secondary ${editor === name ? 'is-active' : ''}`} type="button" aria-expanded={editor === name} onClick={() => toggle(name)}>{label}</button>;

  return <DraftContext.Provider value={{ drafts, setDrafts }}><div className={`finance-page finance-view-${view}`}>
    <div className="finance-controls">
      <PageHeader title="Finance" subtitle="Your profit, spending and budget" />
      {headerPeriod && <FinanceAnswer period={headerPeriod} label={view === 'month' ? `${monthName(month)} ${year}` : String(year)} />}
      <div className="finance-report-actions"><button className="button" type="button" onClick={() => setEditor('entries')}>Add expense</button><details className="finance-more"><summary className="button secondary">More report actions</summary><div><button className="button secondary" type="button" disabled={!loaded || busy} onClick={() => void exportFile()}><Download size={16} />Export CSV</button><button className="button secondary" type="button" disabled={!loaded} onClick={() => window.print()}><Printer size={16} />Print</button></div></details></div>
      <MotionTabs aria-label="Finance report view" items={views} value={view} onValueChange={setView} />
      <section className="panel finance-toolbar" aria-label="Finance report filters">
        <label><span>Year</span><SelectControl aria-label="Finance year" value={String(year)} onValueChange={value => setYear(Number(value))} options={Array.from({ length: 8 }, (_, i) => String(thisYear + 1 - i)).map(value => ({ value, label: value }))} /></label>
        {view === 'month' && <label><span>Month</span><SelectControl aria-label="Finance month" value={monthNumber} onValueChange={setMonthNumber} options={Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => ({ value, label: monthName(`${year}-${value}`) }))} /></label>}
        <div className="finance-editor-buttons">{editorButton('budget', 'Set budget')}{editorButton('entries', 'Expenses and other revenue')}{editorButton('categories', 'Categories')}</div>
      </section>
    </div>
    {Object.keys(drafts).some(key => /^(budget|entry|category):/.test(key)) && <p className="finance-draft-status finance-controls" role="status">Unsaved Finance drafts are kept while you switch editors, views and months. Save or discard them in their editor. Leaving Finance or reloading clears them.</p>}
    {error && <div role="alert" className="form-error finance-read-error"><p>Finance report could not load. Check your connection, then retry this report.</p>{loaded && reportUpdated && <p>Displayed report is out of date. Last loaded {reportUpdated.toLocaleTimeString()}.</p>}<p>{error}</p><button className="button secondary" type="button" disabled={reportLoading} onClick={() => { setReportLoading(true); setReportRetry(value => value + 1); }}>{reportLoading ? 'Retrying…' : 'Retry report'}</button></div>}
    {loaded && selectedMonth && <>
      <div className="finance-controls">
        {editor === 'budget' && <BudgetEditor key={`${month}:${revision}`} report={loaded} month={month} setMonth={setMonthNumber} busy={busy} readOnly={readOnly} save={bodies => save(async () => { for (const body of bodies) await api.saveFinanceBudget(accessToken!, body); })} />}
        {editor === 'entries' && <EntryEditor report={loaded} revision={revision} busy={busy} readOnly={readOnly} save={(body, id) => save(() => api.saveFinanceEntry(accessToken!, body, id))} remove={id => save(() => api.deleteFinanceEntry(accessToken!, id))} />}
        {editor === 'categories' && <CategoryEditor key={revision} categories={loaded.categories} busy={busy} readOnly={readOnly} save={(body, id) => save(() => api.saveFinanceCategory(accessToken!, body, id))} />}
        {!hasBudget && editor !== 'budget' && <Notice title={`No budget set for ${view === 'month' ? monthName(month) : year}`} action={<button className="button secondary" type="button" onClick={() => setEditor('budget')}>Set budget</button>}>Your actuals are shown below. Add a monthly budget to compare them with your plan; you can copy one month across the year.</Notice>}
        {coverageSource?.futureDatedRecords && <Notice title="Some records are dated after today">They are not in these actuals yet and will count once their date arrives.</Notice>}
        {coverageSource && coverageSource.profitability.uncostedSaleUnits > 0 && <Notice title={`${coverageSource.profitability.uncostedSaleUnits} sold units have no recorded cost or price`} action={<Link className="button secondary" to="/profitability">Open Profit</Link>}>Cost coverage is {coverageSource.costCoveragePercent}%. These sales stay out of gross profit until their cost is known, so real profit may differ.</Notice>}
      </div>
      <section className="panel finance-statement">
        <header className="panel-header finance-statement-header"><div><p>Budget vs Actual Profit and Loss</p>{headerPeriod && headerPeriod.status !== 'complete' && <span className={`catalog-badge finance-status ${headerPeriod.status}`}>{statusLabel[headerPeriod.status]}</span>}</div><div><h2>{loaded.company.name}</h2><p>{periodLabel}</p><small>All amounts in {loaded.company.currency}</small></div></header>
        <div className="finance-statement-body">
          {headerPeriod && <Basis period={headerPeriod} view={view} />}
          {view === 'months' ? <AllMonths report={loaded} onOpen={value => { setMonthNumber(value.slice(5, 7)); setView('month'); }} /> : period && <Statement period={period} heading={view === 'month' ? `${monthName(month)} ${year}` : String(year)} kind={view === 'month' ? 'month' : 'year'} hasBudget={Boolean(hasBudget)} />}
          <p className="finance-footnote">Positive variance is favourable to profit; red is unfavourable. Percentages are relative to budget, and a dash means there is no budget to compare.</p>
          {period && view !== 'months' && <Reconciliation period={period} />}
          {view === 'months' && <Reconciliation period={loaded.yearly} />}
        </div>
      </section>
    </>}
    {!report && !error && <EmptyState text="Loading finance report" />}
  </div></DraftContext.Provider>;
}

function FinanceAnswer({ period, label }: { period: FinancePeriod; label: string }) {
  const { money, calendarDate } = useCompanySettings();
  const actual = (key: string) => lineOf(period, key).actualCents;
  const amount = (value: number | null) => value === null ? '—' : money(value);
  const net = actual('net_profit');
  return <section className="panel finance-answer" aria-label="Actual money summary">
    <p className="finance-answer-period">{label} · All places{period.status === 'in_progress' && period.actualsTo ? ` · To ${calendarDate(period.actualsTo)}` : ''}</p>
    <h2>{net !== null && net < 0 ? 'Net loss' : 'Net profit'}</h2><strong className="finance-answer-net">{amount(net)}</strong>
    <dl><div><dt>Net sales</dt><dd>{period.status === 'future' ? '—' : money(period.profitability.netSalesCents)}</dd></div><div><dt>Cost of stock sold</dt><dd>{amount(actual('cogs'))}</dd></div><div><dt>Expenses</dt><dd>{amount(actual('expenses'))}</dd></div><div><dt>Other revenue</dt><dd>{amount(actual('other_revenue'))}</dd></div></dl>
    <p>{period.status === 'future' ? 'This period has not started. Only the budget is available below.' : 'Recorded sales after discounts and returns, plus other revenue, less stock costs and expenses. These figures do not show cash collected.'}</p>
    {period.profitability.uncostedSaleUnits > 0 && <p className="finance-answer-warning">{period.profitability.uncostedSaleUnits} sold units have no recorded cost or price. Cost coverage: {period.costCoveragePercent}%. Profit may differ when their costs are known.</p>}
    <p className="finance-answer-comparison">Actual means recorded results. Budget means your plan. Variance is the difference; positive is favourable to profit.{period.status === 'in_progress' && ' The detailed statement explains the dates and budget being compared.'}</p>
  </section>;
}

const statusLabel: Record<FinanceStatus, string> = { complete: 'Complete', in_progress: 'In progress', future: 'Not started' };

// Says plainly what is being compared, inside the statement so it also prints.
function Basis({ period, view }: { period: FinancePeriod; view: View }) {
  const { calendarDate } = useCompanySettings();
  if (period.status === 'complete') return null;
  const through = period.actualsTo ? calendarDate(period.actualsTo) : '';
  const lastMonth = period.actualsTo ? monthName(period.actualsTo.slice(0, 7)) : '';
  const text = period.status === 'future' ? 'Budget only. Actuals and variance appear once this period starts.'
    : view === 'month' ? `This month is in progress. The budget is the full month, not pro-rated, and actuals run to ${through}, so variances will move until the month ends.`
      : `This year is in progress. Budget and actual both cover January to ${lastMonth}, using ${lastMonth}'s full budget against actuals to ${through}. The full-year budget is shown separately.`;
  return <p className="finance-basis"><b>{statusLabel[period.status]}.</b> {text}</p>;
}

function Notice({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <div className="finance-notice" role="status"><CircleAlert size={18} /><div><b>{title}</b><span>{children}</span></div>{action}</div>;
}

function Reconciliation({ period }: { period: FinancePeriod }) {
  const { money, calendarDate } = useCompanySettings();
  if (!period.actualsTo) return null;
  const actual = (key: string) => lineOf(period, key).actualCents ?? 0;
  return <p className="finance-footnote">Ties to Profit for {calendarDate(period.from)} to {calendarDate(period.actualsTo)}: net sales {money(period.profitability.netSalesCents)} + other revenue {money(actual('other_revenue'))} = total revenue {money(actual('revenue'))}; gross profit there {money(period.profitability.grossProfitCents)} + other revenue = gross profit here {money(actual('gross_profit'))}. Inventory losses appear on Profit separately and are an expense here.</p>;
}

type Columns = { budget: string; actual: string; variance: string; percent: string };
const Dash = ({ label, col }: { label: string; col: string }) => <td className="num finance-empty" data-label={label} data-col={col}>—</td>;

function Amounts({ line, hasBudget, columns, fullYear }: { line: FinanceLine; hasBudget: boolean; columns: Columns; fullYear: boolean }) {
  const { money } = useCompanySettings();
  const tone = varianceTone(line.varianceCents ?? 0);
  const compared = hasBudget && line.varianceCents !== null;
  return <>
    {hasBudget ? <td className="num" data-label={columns.budget} data-col="budget">{money(line.budgetCents)}</td> : <Dash label={columns.budget} col="budget" />}
    {line.actualCents === null ? <Dash label={columns.actual} col="actual" /> : <td className="num" data-label={columns.actual} data-col="actual">{money(line.actualCents)}</td>}
    {compared ? <td className={`num ${tone}`} data-label={columns.variance} data-col="variance">{money(line.varianceCents!)}</td> : <Dash label={columns.variance} col="variance" />}
    {compared && line.variancePercent !== null ? <td className={`num ${tone}`} data-label={columns.percent} data-col="percent">{line.variancePercent.toFixed(2)}%</td> : <Dash label={columns.percent} col="percent" />}
    {fullYear && <td className="num" data-label="Full-year budget" data-col="full">{money(line.fullBudgetCents ?? 0)}</td>}
  </>;
}

function StatementHead({ first, heading, columns, fullYear }: { first: string; heading: string; columns: Columns; fullYear: boolean }) {
  return <thead><tr><th scope="col">{first}</th><th scope="col" className="num"><span className="finance-head-period">{heading} </span>{columns.budget}</th><th scope="col" className="num"><span className="finance-head-period">{heading} </span>{columns.actual}</th><th scope="col" className="num">{columns.variance}</th><th scope="col" className="num">{columns.percent}</th>{fullYear && <th scope="col" className="num">Full-year budget</th>}</tr></thead>;
}

function Statement({ period, heading, kind, hasBudget }: { period: FinancePeriod; heading: string; kind: 'month' | 'year'; hasBudget: boolean }) {
  const partial = period.status === 'in_progress';
  const columns: Columns = partial ? { budget: kind === 'year' ? 'Budget to date' : 'Budget', actual: 'Actual to date', variance: 'Variance so far', percent: '% so far' } : { budget: 'Budget', actual: 'Actual', variance: 'Variance', percent: '% variance' };
  const fullYear = kind === 'year' && partial;
  const width = fullYear ? 6 : 5;
  const shown = period.lines.filter(line => line.key !== 'uncosted' || (line.actualCents ?? 0) !== 0);
  const summaryKeys = ['revenue', 'cogs', 'uncosted', 'expenses', 'net_profit'];
  const summary = summaryKeys.flatMap(key => shown.filter(line => line.key === key));
  const sections = ['Revenue', 'Cost of Goods Sold', 'Expenses'];
  const rowClass = (line: FinanceLine) => line.key === 'net_profit' || line.key === 'gross_profit' ? 'finance-result' : line.editable || line.key === 'uncosted' ? '' : 'finance-total';
  return <>
    <div className="table-wrap finance-table finance-statement-table"><table><caption className="sr-only">Summary, {heading}</caption><StatementHead first="Summary" heading={heading} columns={columns} fullYear={fullYear} /><tbody><tr className="finance-section-row finance-phone-only"><th scope="colgroup" colSpan={width}>Summary</th></tr>{summary.map(line => <tr key={line.key} className={line.key === 'net_profit' ? 'finance-result' : 'finance-total'}><th scope="row">{line.key === 'cogs' ? 'Cost of Goods Sold' : line.label}</th><Amounts line={line} hasBudget={hasBudget} columns={columns} fullYear={fullYear} /></tr>)}</tbody></table></div>
    <div className="table-wrap finance-table finance-statement-table"><table><caption className="sr-only">Statement detail, {heading}</caption>
      {sections.map((section, index) => <tbody key={section}><tr className="finance-section-row"><th scope="colgroup" colSpan={index === 0 ? 1 : width}>{section}</th>{index === 0 && <><td className="num">{columns.budget}</td><td className="num">{columns.actual}</td><td className="num">{columns.variance}</td><td className="num">{columns.percent}</td>{fullYear && <td className="num">Full-year budget</td>}</>}</tr>{shown.filter(line => line.section === section).map(line => <tr key={line.key} className={rowClass(line)}><th scope="row">{line.label}</th><Amounts line={line} hasBudget={hasBudget} columns={columns} fullYear={fullYear} /></tr>)}</tbody>)}
    </table></div>
  </>;
}

function AllMonths({ report, onOpen }: { report: FinanceReport; onOpen: (month: string) => void }) {
  const [metric, setMetric] = useState<Metric>('actual');
  const { yearly } = report;
  const anyBudget = report.months.some(month => month.hasBudget);
  const partial = yearly.status === 'in_progress';
  const amount = (cents: number | null, strong = false) => cents === null ? <td className="num finance-empty">—</td> : <td className="num">{strong ? <b>{plainAmount(cents)}</b> : plainAmount(cents)}</td>;
  const netVariance = (period: FinancePeriod) => { const { varianceCents } = lineOf(period, 'net_profit'); return period.hasBudget && varianceCents !== null ? <td className={`num ${varianceTone(varianceCents)}`}>{plainAmount(varianceCents)}</td> : <td className="num finance-empty">—</td>; };
  const summaryCells = (period: FinancePeriod) => <>{amount(lineOf(period, 'revenue').actualCents)}{amount(lineOf(period, 'cogs').actualCents)}{amount(lineOf(period, 'expenses').actualCents)}{amount(lineOf(period, 'net_profit').actualCents, true)}{amount(period.hasBudget ? lineOf(period, 'net_profit').budgetCents : null)}{netVariance(period)}</>;
  const cell = (line: FinanceLine, label: string, period: FinancePeriod) => {
    const value = metric === 'actual' ? line.actualCents : metric === 'variance' ? (period.hasBudget ? line.varianceCents : null) : (period.hasBudget ? line.budgetCents : null);
    if (value === null) return <td key={label} className="num finance-empty">—</td>;
    return <td key={label} className={`num ${metric === 'variance' ? varianceTone(value) : ''}`}>{plainAmount(value)}</td>;
  };
  const lines = yearly.lines.filter(line => line.key !== 'uncosted' || report.months.some(month => (lineOf(month, 'uncosted').actualCents ?? 0) !== 0));
  const yearLabel = partial ? `${report.year} to date` : yearly.status === 'future' ? `${report.year} budget` : `${report.year} total`;
  return <>
    <div className="table-wrap finance-table finance-sticky finance-month-summary"><table><caption className="sr-only">Month summary, {report.year}</caption>
      <thead><tr><th scope="col">Month</th><th scope="col" className="num">Revenue</th><th scope="col" className="num">Cost of goods</th><th scope="col" className="num">Expenses</th><th scope="col" className="num">Net profit</th><th scope="col" className="num">Budget net</th><th scope="col" className="num">Net variance</th></tr></thead>
      <tbody>{report.months.map((month: FinanceMonth) => <tr key={month.month} className={month.status === 'future' ? 'finance-future-row' : ''}><th scope="row"><button className="finance-month-link" type="button" onClick={() => onOpen(month.month)}>{monthName(month.month)}</button>{month.status !== 'complete' && <small className="finance-row-status">{statusLabel[month.status]}</small>}</th>{summaryCells(month)}</tr>)}<tr className="finance-result"><th scope="row">{yearLabel}</th>{summaryCells(yearly)}</tr>{partial && <tr className="finance-total"><th scope="row">Full-year budget</th><td className="num finance-empty">—</td><td className="num finance-empty">—</td><td className="num finance-empty">—</td><td className="num finance-empty">—</td>{amount(lineOf(yearly, 'net_profit').fullBudgetCents ?? 0)}<td className="num finance-empty">—</td></tr>}</tbody>
    </table></div>
    <div className="finance-grid-heading"><h3>Every line by month</h3><label><span className="sr-only">Figures shown</span><SelectControl aria-label="Figures shown" value={metric} onValueChange={next => setMetric(next as Metric)} options={[{ value: 'actual', label: 'Actual' }, { value: 'budget', label: 'Budget', disabled: !anyBudget }, { value: 'variance', label: 'Variance', disabled: !anyBudget }]} /></label></div>
    <div className="table-wrap finance-table finance-sticky finance-month-grid"><table><caption className="sr-only">{metric} by line and month, {report.year}</caption>
      <thead><tr><th scope="col">Line</th>{report.months.map(month => <th key={month.month} scope="col" className="num">{monthName(month.month, 'short')}</th>)}<th scope="col" className="num">{partial ? 'To date' : report.year}</th>{partial && metric === 'budget' && <th scope="col" className="num">Full year</th>}</tr></thead>
      <tbody>{lines.map(line => <tr key={line.key} className={line.key === 'net_profit' || line.key === 'gross_profit' ? 'finance-result' : line.editable || line.key === 'uncosted' ? '' : 'finance-total'}><th scope="row">{line.label}</th>{report.months.map(month => cell(lineOf(month, line.key), month.month, month))}{cell(line, 'year', yearly)}{partial && metric === 'budget' && <td className="num">{plainAmount(line.fullBudgetCents ?? 0)}</td>}</tr>)}</tbody>
    </table></div>
  </>;
}

const toAmount = (cents: number) => (cents === 0 ? '' : (Math.abs(cents) / 100).toFixed(2));

function BudgetEditor({ report, month, setMonth, busy, readOnly, save }: { report: FinanceReport; month: string; setMonth: (month: string) => void; busy: boolean; readOnly: boolean; save: (bodies: FinanceBudgetInput[]) => Promise<void> }) {
  const { money } = useCompanySettings();
  const period = report.months.find(row => row.month === month)!;
  const editable = period.lines.filter(line => line.editable);
  const [amounts, setAmounts, clearAmounts, dirty] = useFinanceDraft<Record<string, string>>(`budget:${month}`, Object.fromEntries(editable.map(line => [line.key, toAmount(line.budgetCents)])));
  const [added, setAdded, clearAdded] = useFinanceDraft<string[]>(`budgetLines:${month}`, []);
  const [targets, setTargets, clearTargets] = useFinanceDraft<string[]>(`copyMonths:${month}`, []);
  const [copyOpen, setCopyOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const used = (key: string) => report.months.some(row => row.lines.some(line => line.key === key && ((line.actualCents ?? 0) !== 0 || line.budgetCents !== 0)));
  const visible = editable.filter(line => advanced || ['sales', 'cogs'].includes(line.key) || used(line.key) || added.includes(line.key));
  const remaining = editable.filter(line => !visible.includes(line));
  const cents = (key: string) => parseMoneyCents(amounts[key] || '0') ?? 0;
  const planned = editable.reduce((total, line) => total + (line.section === 'Expenses' || ['cogs', 'discounts', 'returns'].includes(line.key) ? -1 : 1) * cents(line.key), 0);
  const commit = (copy: boolean) => {
    const lines = editable.map(line => ({ lineKey: line.key, amountCents: amounts[line.key] ? parseMoneyCents(amounts[line.key]) : 0 }));
    if (lines.some(line => line.amountCents === null)) { setInvalid(true); return; }
    setInvalid(false);
    const base = { lines: lines as FinanceBudgetInput['lines'], copyToYear: false };
    const bodies = copy ? targets.length === 12 ? [{ ...base, month: `${month}-01`, copyToYear: true }] : targets.map(target => ({ ...base, month: `${target}-01` })) : [{ ...base, month: `${month}-01` }];
    void save(bodies).then(() => { if (!copy || targets.includes(month)) { clearAmounts(); clearAdded(); } clearTargets(); setCopyOpen(false); }).catch(() => {});
  };
  return <Panel className="finance-management" title="Monthly budget" subtitle={`Plan in ${report.company.currency}. Blank means zero; discounts, returns and expenses reduce planned profit.`}><form className="finance-budget-form" onSubmit={event => { event.preventDefault(); commit(false); }}>
    <label className="finance-budget-month"><span>Budget month</span><SelectControl disabled={busy} aria-label="Budget month" value={month.slice(5, 7)} onValueChange={setMonth} options={report.months.map(row => ({ value: row.month.slice(5, 7), label: `${monthName(row.month)} ${report.year}` }))} /></label>
    <label className="finance-copy"><input type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} /><span>Show complete budget worksheet</span></label>
    {['Revenue', 'Cost of Goods Sold', 'Expenses'].map(section => <fieldset className="budget-group" key={section}><legend>{section === 'Revenue' ? 'Sales and other revenue' : section === 'Expenses' ? 'Operating expenses' : 'Stock cost'}</legend><div className="finance-budget-grid">{visible.filter(line => line.section === section).map(line => <label key={line.key}><span>{line.label}</span><InputControl disabled={busy} aria-label={`${line.label} budget`} type="number" inputMode="decimal" min="0" max="21474836.47" step="0.01" placeholder="0.00" value={amounts[line.key] ?? ''} onValueChange={value => setAmounts(current => ({ ...current, [line.key]: value }))} /></label>)}</div>{section === 'Expenses' && !visible.some(line => line.section === section) && <p>No expense lines yet. Add rent, utilities or another cost below.</p>}</fieldset>)}
    {remaining.length > 0 && <label><span>Add a budget line</span><SelectControl aria-label="Add a budget line" value="" onValueChange={key => setAdded(current => [...current, key])} options={[{ value: '', label: 'Choose a line' }, ...remaining.map(line => ({ value: line.key, label: line.label }))]} /></label>}
    {invalid && <p className="form-error" role="alert">Use amounts with no more than two decimal places.</p>}
    <div className="budget-save-bar"><p role="status">Planned {planned < 0 ? 'loss' : 'profit'} <strong>{money(Math.abs(planned))}</strong></p><button className="button" disabled={busy || readOnly}>{busy ? 'Saving…' : `Save ${monthName(month)} budget`}</button>{dirty && <button className="button secondary" type="button" disabled={busy} onClick={() => { clearAmounts(); clearAdded(); clearTargets(); }}>Discard this month’s draft</button>}</div>
    <button className="button secondary" type="button" aria-expanded={copyOpen} onClick={() => setCopyOpen(value => !value)}>Copy this month…</button>
    {copyOpen && <fieldset className="budget-copy-panel"><legend>Copy {monthName(month)} amounts</legend><p>This saves the amounts above to the selected months. Existing budgets in those months are replaced.</p><label className="finance-copy"><input type="checkbox" disabled={busy} checked={targets.length === 12} onChange={event => setTargets(event.target.checked ? report.months.map(row => row.month) : [])} /><span>Copy these amounts to all 12 months of {report.year}</span></label><div className="budget-months">{report.months.map(row => <label key={row.month}><input type="checkbox" disabled={busy} checked={targets.includes(row.month)} onChange={event => setTargets(current => event.target.checked ? [...current, row.month] : current.filter(value => value !== row.month))} />{monthName(row.month)}{row.hasBudget ? ' (replace budget)' : ' (no budget)'}</label>)}</div><p role="status">Selected: {targets.length ? report.months.filter(row => targets.includes(row.month)).map(row => `${monthName(row.month)}${row.hasBudget ? ' (replace)' : ' (new)'}`).join(', ') : 'No months selected'}.</p><p>If a connection fails during a selected-month copy, earlier months may already be saved. Retry the same selection to finish.</p><button className="button" type="button" disabled={!targets.length || busy || readOnly} onClick={() => commit(true)}>{targets.length === 12 ? `Save for all of ${report.year}` : `Copy to ${targets.length} selected ${targets.length === 1 ? 'month' : 'months'}`}</button></fieldset>}
  </form></Panel>;
}

function EntryEditor({ report, revision, busy, readOnly, save, remove }: { report: FinanceReport; revision: number; busy: boolean; readOnly: boolean; save: (body: FinanceEntryInput, id?: string) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const { accessToken } = useAuth();
  const { money, calendarDate } = useCompanySettings();
  const blank = { kind: 'expense' as FinanceEntry['kind'], categoryId: report.categories.find(category => category.isActive)?.id ?? '', entryDate: companyDay(report.company.timeZone), amount: '', note: '' };
  const [editing, setEditing] = useFinanceDraft<string | undefined>('entryEditing', undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const entryHeading = useRef<HTMLHeadingElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const returnToEntry = () => { setEditing(undefined); setSaveFailed(false); requestAnimationFrame(() => editTrigger.current?.focus()); };
  const revealEditor = () => requestAnimationFrame(() => { entryHeading.current?.focus(); entryHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
  const { drafts, setDrafts } = useContext(DraftContext)!;
  const [form, setForm, clearForm, dirty] = useFinanceDraft(`entry:${editing ?? 'new'}`, blank);
  const [invalid, setInvalid] = useState(false);
  const [range, setRange] = useState<DateRangeValue>({ days: null, from: `${report.year}-01-01`, to: `${report.year}-12-31` });
  const [list, setList] = useState<FinanceEntryList | null>(null);
  const rangeKey = JSON.stringify(range);
  const [listScope, setListScope] = useState('');
  const rows = listScope === rangeKey ? list?.entries ?? null : null;
  const [entriesRetry, setEntriesRetry] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesUpdated, setEntriesUpdated] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void api.financeEntries(accessToken, rangeQuery(range, report.company.timeZone)).then(next => { if (active) { setList(next); setListScope(rangeKey); setEntriesUpdated(new Date()); setLoadError(false); } }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setEntriesLoading(false); });
    return () => { active = false; };
  }, [accessToken, range, rangeKey, report.company.timeZone, revision, entriesRetry]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amountCents = parseMoneyCents(form.amount);
    if (!amountCents) { setInvalid(true); return; }
    setInvalid(false);
    void save({ kind: form.kind, ...(form.kind === 'expense' ? { categoryId: form.categoryId } : {}), entryDate: form.entryDate, amountCents, note: form.note }, editing).then(() => { clearForm(); if (editing) returnToEntry(); else setSaveFailed(false); }).catch(() => setSaveFailed(true));
  };
  // An archived category stays selectable only for the entry already filed under it.
  const options = report.categories.filter(category => category.isActive || category.id === form.categoryId).map(category => ({ value: category.id, label: category.isActive ? category.name : `${category.name} (archived)` }));
  const editingEntry = list?.entries.find(entry => entry.id === editing);
  const editingLabel = editing ? `Edit ${form.kind === 'expense' ? 'expense' : 'other revenue'} · ${calendarDate(editingEntry?.entryDate ?? form.entryDate)} · ${form.kind === 'expense' ? report.categories.find(category => category.id === form.categoryId)?.name ?? 'Expense' : 'Other revenue'}` : 'Expenses and other revenue';
  return <Panel className="finance-management finance-entry-editor" headingRef={entryHeading} title={editingLabel} subtitle="Each entry counts in the report on its own date.">
    <form className="finance-entry-form" onSubmit={submit}>
      <label><span>Entry type</span><SelectControl disabled={busy} aria-label="Entry type" value={form.kind} onValueChange={value => setForm({ ...form, kind: value as FinanceEntry['kind'] })} options={[{ value: 'expense', label: 'Operating expense' }, { value: 'other_revenue', label: 'Other revenue' }]} /></label>
      {form.kind === 'expense' && <label><span>Expense category</span><SelectControl disabled={busy} aria-label="Expense category" required value={form.categoryId} onValueChange={categoryId => setForm({ ...form, categoryId })} options={options} /></label>}
      <label><span>Date</span><DatePicker disabled={busy} label="Entry date" aria-label="Entry date" required value={form.entryDate} onValueChange={entryDate => setForm({ ...form, entryDate })} /></label>
      <label><span>Amount ({report.company.currency})</span><InputControl disabled={busy} aria-label="Entry amount" type="number" inputMode="decimal" required min="0.01" max="21474836.47" step="0.01" value={form.amount} onValueChange={amount => setForm({ ...form, amount })} /></label>
      <label className="finance-entry-note"><span>Note</span><InputControl disabled={busy} aria-label="Entry note" maxLength={500} value={form.note} onValueChange={note => setForm({ ...form, note })} /></label>
      <div className="finance-entry-actions"><button className="button" disabled={busy || readOnly}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Record entry'}</button>{editing && <button type="button" className="button secondary" disabled={busy} onClick={returnToEntry}>Cancel edit</button>}{dirty && <button type="button" className="button secondary" disabled={busy} onClick={() => { clearForm(); if (editing) returnToEntry(); }}>Discard entry draft</button>}</div>
      {saveFailed && <p className="form-error" role="alert">The entry could not save. Your values are kept. Check your connection and try the Save action again.</p>}
      {invalid && <p className="form-error" role="alert">Enter an amount above zero with no more than two decimal places.</p>}
    </form>
    <div className="finance-entry-filter"><DateRangePicker allowAll value={range} onChange={setRange} label="Finance entry period" /></div>
    {list?.truncated && <div className="finance-entry-filter"><Notice title={`Showing the latest ${list.limit} entries`}>Older entries in this period are not listed, so narrow the dates to find them. The report totals are not affected and include every entry.</Notice></div>}
    {loadError && <div className="form-error finance-read-error" role="alert"><p>Entries could not load. Check your connection, then retry the entry list. Your draft is kept.</p>{rows && entriesUpdated && <p>Displayed entries are out of date. Last loaded {entriesUpdated.toLocaleTimeString()}.</p>}<button className="button secondary" type="button" disabled={entriesLoading} onClick={() => { setEntriesLoading(true); setEntriesRetry(value => value + 1); }}>{entriesLoading ? 'Retrying…' : 'Retry entries'}</button></div>}
    {rows === null ? !loadError && <EmptyState text="Loading entries" /> : rows.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th className="num">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(entry => <tr key={entry.id}><td>{calendarDate(entry.entryDate)}</td><td>{entry.kind === 'other_revenue' ? 'Other Revenue' : report.categories.find(category => category.id === entry.categoryId)?.name}</td><td>{entry.note || '—'}</td><td className="num">{money(entry.amountCents)}</td><td className="finance-row-actions">{deleting === entry.id
      ? <><button type="button" className="text-button negative" disabled={busy || readOnly} onClick={() => { setDeleting(null); void remove(entry.id).catch(() => {}); }}>Confirm delete</button><button type="button" className="text-button" onClick={() => setDeleting(null)}>Keep</button></>
      : <><button type="button" className="text-button" disabled={busy} data-edit-entry={entry.id} onClick={event => { editTrigger.current = event.currentTarget; setSaveFailed(false); const key = `entry:${entry.id}`; if (!(key in drafts)) setDrafts(current => ({ ...current, [key]: { kind: entry.kind, categoryId: entry.categoryId ?? blank.categoryId, entryDate: entry.entryDate, amount: (entry.amountCents / 100).toFixed(2), note: entry.note } })); setEditing(entry.id); revealEditor(); }}>Edit</button><button type="button" className="text-button negative" disabled={busy} onClick={() => setDeleting(entry.id)}>Delete</button></>}</td></tr>)}</tbody></table></div> : <EmptyState text="No entries in this period." />}
  </Panel>;
}

function CategoryEditor({ categories, busy, readOnly, save }: { categories: FinanceCategory[]; busy: boolean; readOnly: boolean; save: (body: { name: string; isActive: boolean }, id?: string) => Promise<void> }) {
  const [name, setName, clearName] = useFinanceDraft('category:new', '');
  return <Panel className="finance-management" title="Expense categories" subtitle="Archived categories stop appearing in new entries but stay in reports that have amounts against them.">
    <form className="finance-category-row finance-category-add" onSubmit={event => { event.preventDefault(); void save({ name, isActive: true }).then(clearName).catch(() => {}); }}><InputControl disabled={busy} aria-label="New category" placeholder="New category" required maxLength={80} value={name} onValueChange={setName} /><button className="button" disabled={busy || readOnly}>Add category</button>{name && <button className="button secondary" type="button" disabled={busy} onClick={clearName}>Discard category draft</button>}</form>
    <div className="finance-category-list">{categories.map(category => <CategoryRow key={category.id} category={category} busy={busy} readOnly={readOnly} save={body => save(body, category.id)} />)}</div>
  </Panel>;
}

function CategoryRow({ category, busy, readOnly, save }: { category: FinanceCategory; busy: boolean; readOnly: boolean; save: (body: { name: string; isActive: boolean }) => Promise<void> }) {
  const [name, setName, clearName] = useFinanceDraft(`category:${category.id}`, category.name);
  return <form className={`finance-category-row ${category.isActive ? '' : 'is-archived'}`} onSubmit={event => { event.preventDefault(); void save({ name, isActive: category.isActive }).then(clearName).catch(() => {}); }}><InputControl disabled={busy} aria-label={`Category name: ${category.name}`} required maxLength={80} value={name} onValueChange={setName} /><button className="button secondary" disabled={busy || readOnly || name.trim() === category.name}>Rename</button>{name !== category.name && <button className="text-button" type="button" disabled={busy} onClick={clearName}>Discard rename</button>}<button type="button" className="text-button" disabled={busy || readOnly} onClick={() => void save({ name: category.name, isActive: !category.isActive }).catch(() => {})}>{category.isActive ? 'Archive' : 'Restore'}</button></form>;
}
