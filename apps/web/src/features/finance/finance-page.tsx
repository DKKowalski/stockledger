import { CircleAlert, Download, Printer } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import type { FinanceBudgetInput, FinanceCategory, FinanceEntry, FinanceEntryInput, FinanceLine, FinanceMonth, FinancePeriod, FinanceReport } from './finance-types';

type View = 'month' | 'months' | 'year';
type Editor = 'budget' | 'entries' | 'categories' | null;
type Metric = 'actual' | 'budget' | 'variance';

const views = [{ value: 'month', label: 'Month' }, { value: 'months', label: 'All months' }, { value: 'year', label: 'Yearly' }] as const;
const monthName = (month: string, format: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(undefined, { month: format, timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
const lineOf = (period: FinancePeriod, key: string) => period.lines.find(line => line.key === key)!;
const varianceTone = (cents: number) => (cents < 0 ? 'negative' : cents > 0 ? 'positive' : '');
// The twelve-month grid drops the currency symbol to stay readable; the statement header names the currency.
const plainAmount = (cents: number) => (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FinancePage() {
  const { accessToken, user, signOut } = useAuth();
  const { settings, calendarDate } = useCompanySettings();
  const today = companyDay(settings?.timeZone);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [monthNumber, setMonthNumber] = useState(today.slice(5, 7));
  const [view, setView] = useState<View>('month');
  const [editor, setEditor] = useState<Editor>(null);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const month = `${year}-${monthNumber}`;
  const readOnly = Boolean(user?.isDemo);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void api.finance(accessToken, year).then(result => { if (active) { setReport(result); setError(null); } }).catch(caught => {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else if (active) { setReport(null); setError(safeErrorMessage(caught, 'Could not load finance report')); }
    });
    return () => { active = false; };
  }, [accessToken, year, revision, signOut]);

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
  const periodLabel = view === 'month' && selectedMonth ? `For the month ended ${calendarDate(selectedMonth.to)}` : `For the year ended ${calendarDate(`${year}-12-31`)}`;

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

  return <div className={`finance-page finance-view-${view}`}>
    <div className="finance-controls">
      <PageHeader title="Finance" subtitle="Budget vs actual profit and loss" actions={<><button className="button secondary" type="button" disabled={!loaded || busy} onClick={() => void exportFile()}><Download size={16} />Export CSV</button><button className="button secondary" type="button" disabled={!loaded} onClick={() => window.print()}><Printer size={16} />Print</button></>} />
      <MotionTabs aria-label="Finance report view" items={views} value={view} onValueChange={setView} />
      <section className="panel finance-toolbar" aria-label="Finance report filters">
        <label><span>Year</span><SelectControl aria-label="Finance year" value={String(year)} onValueChange={value => setYear(Number(value))} options={Array.from({ length: 8 }, (_, i) => String(thisYear + 1 - i)).map(value => ({ value, label: value }))} /></label>
        {view === 'month' && <label><span>Month</span><SelectControl aria-label="Finance month" value={monthNumber} onValueChange={setMonthNumber} options={Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => ({ value, label: monthName(`${year}-${value}`) }))} /></label>}
        <div className="finance-editor-buttons">{editorButton('budget', 'Set budget')}{editorButton('entries', 'Expenses and other revenue')}{editorButton('categories', 'Categories')}</div>
      </section>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loaded && selectedMonth && <>
      <div className="finance-controls">
        {editor === 'budget' && <BudgetEditor key={`${month}:${revision}`} report={loaded} month={month} setMonth={setMonthNumber} busy={busy} readOnly={readOnly} save={body => save(() => api.saveFinanceBudget(accessToken!, body))} />}
        {editor === 'entries' && <EntryEditor report={loaded} revision={revision} busy={busy} readOnly={readOnly} save={(body, id) => save(() => api.saveFinanceEntry(accessToken!, body, id))} remove={id => save(() => api.deleteFinanceEntry(accessToken!, id))} />}
        {editor === 'categories' && <CategoryEditor key={revision} categories={loaded.categories} busy={busy} readOnly={readOnly} save={(body, id) => save(() => api.saveFinanceCategory(accessToken!, body, id))} />}
        {!hasBudget && editor !== 'budget' && <Notice title={`No budget set for ${view === 'month' ? monthName(month) : year}`} action={<button className="button secondary" type="button" onClick={() => setEditor('budget')}>Set budget</button>}>Your actuals are shown below. Add a monthly budget to compare them with your plan; you can copy one month across the year.</Notice>}
        {coverageSource && coverageSource.profitability.uncostedSaleUnits > 0 && <Notice title={`${coverageSource.profitability.uncostedSaleUnits} sold units have no recorded cost or price`} action={<Link className="button secondary" to="/profitability">Open Profit</Link>}>Cost coverage is {coverageSource.costCoveragePercent}%. These sales stay out of gross profit until their cost is known, so real profit may differ.</Notice>}
      </div>
      <section className="panel finance-statement">
        <header className="finance-statement-header"><div><p>Budget vs Actual Profit and Loss</p></div><div><h2>{loaded.company.name}</h2><p>{periodLabel}</p><small>All amounts in {loaded.company.currency}</small></div></header>
        <div className="finance-statement-body">
          {view === 'months' ? <AllMonths report={loaded} onOpen={value => { setMonthNumber(value.slice(5, 7)); setView('month'); }} /> : period && <Statement period={period} heading={view === 'month' ? `${monthName(month)} ${year}` : String(year)} hasBudget={Boolean(hasBudget)} />}
          <p className="finance-footnote">Positive variance is favourable to profit; red is unfavourable. Percentages are relative to budget, and a dash means there is no budget to compare.{view !== 'month' && year === thisYear ? ` ${year} is still in progress, so the yearly budget covers all 12 months while actuals run to today.` : ''}</p>
          {period && view !== 'months' && <Reconciliation period={period} />}
          {view === 'months' && <Reconciliation period={loaded.yearly} />}
        </div>
      </section>
    </>}
    {!report && !error && <EmptyState text="Loading finance report" />}
  </div>;
}

function Notice({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <div className="finance-notice" role="status"><CircleAlert size={18} /><div><b>{title}</b><span>{children}</span></div>{action}</div>;
}

function Reconciliation({ period }: { period: FinancePeriod }) {
  const { money } = useCompanySettings();
  const other = lineOf(period, 'other_revenue').actualCents;
  return <p className="finance-footnote">Ties to Profit for the same dates: net sales {money(period.profitability.netSalesCents)} + other revenue {money(other)} = total revenue {money(lineOf(period, 'revenue').actualCents)}; gross profit there {money(period.profitability.grossProfitCents)} + other revenue = gross profit here {money(lineOf(period, 'gross_profit').actualCents)}. Inventory losses appear on Profit separately and are an expense here.</p>;
}

function Amounts({ line, hasBudget }: { line: FinanceLine; hasBudget: boolean }) {
  const { money } = useCompanySettings();
  if (!hasBudget) return <><td className="num finance-empty">—</td><td className="num">{money(line.actualCents)}</td><td className="num finance-empty">—</td><td className="num finance-empty">—</td></>;
  const tone = varianceTone(line.varianceCents);
  return <><td className="num">{money(line.budgetCents)}</td><td className="num">{money(line.actualCents)}</td><td className={`num ${tone}`}>{money(line.varianceCents)}</td><td className={`num ${line.variancePercent === null ? 'finance-empty' : tone}`}>{line.variancePercent === null ? '—' : `${line.variancePercent.toFixed(2)}%`}</td></>;
}

function StatementHead({ first, heading }: { first: string; heading: string }) {
  return <thead><tr><th scope="col">{first}</th><th scope="col" className="num"><span className="finance-head-period">{heading} </span>budget</th><th scope="col" className="num"><span className="finance-head-period">{heading} </span>actual</th><th scope="col" className="num">Variance</th><th scope="col" className="num">% variance</th></tr></thead>;
}

function Statement({ period, heading, hasBudget }: { period: FinancePeriod; heading: string; hasBudget: boolean }) {
  const shown = period.lines.filter(line => line.key !== 'uncosted' || line.actualCents !== 0);
  const summaryKeys = ['revenue', 'cogs', 'uncosted', 'expenses', 'net_profit'];
  const summary = summaryKeys.flatMap(key => shown.filter(line => line.key === key));
  const sections = ['Revenue', 'Cost of Goods Sold', 'Expenses'];
  const rowClass = (line: FinanceLine) => line.key === 'net_profit' || line.key === 'gross_profit' ? 'finance-result' : line.editable || line.key === 'uncosted' ? '' : 'finance-total';
  return <>
    <div className="table-wrap finance-table"><table><caption className="sr-only">Summary, {heading}</caption><StatementHead first="Summary" heading={heading} /><tbody>{summary.map(line => <tr key={line.key} className={line.key === 'net_profit' ? 'finance-result' : 'finance-total'}><th scope="row">{line.key === 'cogs' ? 'Cost of Goods Sold' : line.label}</th><Amounts line={line} hasBudget={hasBudget} /></tr>)}</tbody></table></div>
    <div className="table-wrap finance-table"><table><caption className="sr-only">Statement detail, {heading}</caption>
      {sections.map((section, index) => <tbody key={section}><tr className="finance-section-row"><th scope="colgroup" colSpan={index === 0 ? 1 : 5}>{section}</th>{index === 0 && <><td className="num">Budget</td><td className="num">Actual</td><td className="num">Variance</td><td className="num">% variance</td></>}</tr>{shown.filter(line => line.section === section).map(line => <tr key={line.key} className={rowClass(line)}><th scope="row">{line.label}</th><Amounts line={line} hasBudget={hasBudget} /></tr>)}</tbody>)}
    </table></div>
  </>;
}

function AllMonths({ report, onOpen }: { report: FinanceReport; onOpen: (month: string) => void }) {
  const { money } = useCompanySettings();
  const [metric, setMetric] = useState<Metric>('actual');
  const hasBudget = report.yearly.hasBudget;
  const netVariance = (period: FinancePeriod) => { const line = lineOf(period, 'net_profit'); return period.hasBudget ? <td className={`num ${varianceTone(line.varianceCents)}`}>{money(line.varianceCents)}</td> : <td className="num finance-empty">—</td>; };
  const summaryCells = (period: FinancePeriod) => <><td className="num">{money(lineOf(period, 'revenue').actualCents)}</td><td className="num">{money(lineOf(period, 'cogs').actualCents)}</td><td className="num">{money(lineOf(period, 'expenses').actualCents)}</td><td className="num"><b>{money(lineOf(period, 'net_profit').actualCents)}</b></td><td className={`num ${period.hasBudget ? '' : 'finance-empty'}`}>{period.hasBudget ? money(lineOf(period, 'net_profit').budgetCents) : '—'}</td>{netVariance(period)}</>;
  const value = (line: FinanceLine) => metric === 'actual' ? line.actualCents : metric === 'budget' ? line.budgetCents : line.varianceCents;
  const cell = (line: FinanceLine, label: string, period: FinancePeriod) => {
    if (metric !== 'actual' && !period.hasBudget) return <td key={label} className="num finance-empty">—</td>;
    return <td key={label} className={`num ${metric === 'variance' ? varianceTone(line.varianceCents) : ''}`}>{plainAmount(value(line))}</td>;
  };
  const lines = report.yearly.lines.filter(line => line.key !== 'uncosted' || line.actualCents !== 0 || report.months.some(month => lineOf(month, 'uncosted').actualCents !== 0));
  return <>
    <div className="table-wrap finance-table finance-sticky finance-month-summary"><table><caption className="sr-only">Month summary, {report.year}</caption>
      <thead><tr><th scope="col">Month</th><th scope="col" className="num">Revenue</th><th scope="col" className="num">Cost of goods</th><th scope="col" className="num">Expenses</th><th scope="col" className="num">Net profit</th><th scope="col" className="num">Budget net</th><th scope="col" className="num">Net variance</th></tr></thead>
      <tbody>{report.months.map((month: FinanceMonth) => <tr key={month.month}><th scope="row"><button className="finance-month-link" type="button" onClick={() => onOpen(month.month)}>{monthName(month.month)}</button></th>{summaryCells(month)}</tr>)}<tr className="finance-result"><th scope="row">{report.year} total</th>{summaryCells(report.yearly)}</tr></tbody>
    </table></div>
    <div className="finance-grid-heading"><h3>Every line by month</h3><label><span className="sr-only">Figures shown</span><SelectControl aria-label="Figures shown" value={metric} onValueChange={next => setMetric(next as Metric)} options={[{ value: 'actual', label: 'Actual' }, { value: 'budget', label: 'Budget', disabled: !hasBudget }, { value: 'variance', label: 'Variance', disabled: !hasBudget }]} /></label></div>
    <div className="table-wrap finance-table finance-sticky finance-month-grid"><table><caption className="sr-only">{metric} by line and month, {report.year}</caption>
      <thead><tr><th scope="col">Line</th>{report.months.map(month => <th key={month.month} scope="col" className="num">{monthName(month.month, 'short')}</th>)}<th scope="col" className="num">{report.year}</th></tr></thead>
      <tbody>{lines.map(line => <tr key={line.key} className={line.key === 'net_profit' || line.key === 'gross_profit' ? 'finance-result' : line.editable || line.key === 'uncosted' ? '' : 'finance-total'}><th scope="row">{line.label}</th>{report.months.map(month => cell(lineOf(month, line.key), month.month, month))}{cell(line, 'year', report.yearly)}</tr>)}</tbody>
    </table></div>
  </>;
}

const toAmount = (cents: number) => (cents === 0 ? '' : (Math.abs(cents) / 100).toFixed(2));

function BudgetEditor({ report, month, setMonth, busy, readOnly, save }: { report: FinanceReport; month: string; setMonth: (month: string) => void; busy: boolean; readOnly: boolean; save: (body: FinanceBudgetInput) => Promise<void> }) {
  const period = report.months.find(row => row.month === month)!;
  const editable = period.lines.filter(line => line.editable);
  const [amounts, setAmounts] = useState<Record<string, string>>(Object.fromEntries(editable.map(line => [line.key, toAmount(line.budgetCents)])));
  const [copyToYear, setCopy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const lines = editable.map(line => ({ lineKey: line.key, amountCents: amounts[line.key] ? parseMoneyCents(amounts[line.key]) : 0 }));
    if (lines.some(line => line.amountCents === null)) { setInvalid(true); return; }
    setInvalid(false);
    void save({ month: `${month}-01`, copyToYear, lines: lines as FinanceBudgetInput['lines'] }).catch(() => {});
  };
  return <Panel className="finance-management" title="Monthly budget" subtitle={`Enter positive amounts in ${report.company.currency}. Sales discounts and returns are deducted from revenue for you.`}><form className="finance-budget-form" onSubmit={submit}>
    <label className="finance-budget-month"><span>Budget month</span><SelectControl aria-label="Budget month" value={month.slice(5, 7)} onValueChange={setMonth} options={report.months.map(row => ({ value: row.month.slice(5, 7), label: `${monthName(row.month)} ${report.year}` }))} /></label>
    <div className="finance-budget-grid">{editable.map(line => <label key={line.key}><span>{line.label}</span><InputControl aria-label={`${line.label} budget`} type="number" inputMode="decimal" min="0" max="21474836.47" step="0.01" placeholder="0.00" value={amounts[line.key]} onValueChange={value => setAmounts(current => ({ ...current, [line.key]: value }))} /></label>)}</div>
    {invalid && <p className="form-error" role="alert">Use amounts with no more than two decimal places.</p>}
    <label className="finance-copy"><input type="checkbox" checked={copyToYear} onChange={event => setCopy(event.target.checked)} /><span>Copy these amounts to all 12 months of {report.year}. This replaces budgets already set for those months.</span></label>
    <button className="button" disabled={busy || readOnly}>{copyToYear ? `Save for all of ${report.year}` : `Save ${monthName(month)} budget`}</button>
  </form></Panel>;
}

function EntryEditor({ report, revision, busy, readOnly, save, remove }: { report: FinanceReport; revision: number; busy: boolean; readOnly: boolean; save: (body: FinanceEntryInput, id?: string) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const { accessToken } = useAuth();
  const { money, calendarDate } = useCompanySettings();
  const blank = { kind: 'expense' as FinanceEntry['kind'], categoryId: report.categories.find(category => category.isActive)?.id ?? '', entryDate: companyDay(report.company.timeZone), amount: '', note: '' };
  const [editing, setEditing] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [invalid, setInvalid] = useState(false);
  const [range, setRange] = useState<DateRangeValue>({ days: null, from: `${report.year}-01-01`, to: `${report.year}-12-31` });
  const [rows, setRows] = useState<FinanceEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void api.financeEntries(accessToken, rangeQuery(range, report.company.timeZone)).then(next => { if (active) { setRows(next); setLoadError(false); } }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [accessToken, range, report.company.timeZone, revision]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amountCents = parseMoneyCents(form.amount);
    if (!amountCents) { setInvalid(true); return; }
    setInvalid(false);
    void save({ kind: form.kind, ...(form.kind === 'expense' ? { categoryId: form.categoryId } : {}), entryDate: form.entryDate, amountCents, note: form.note }, editing).then(() => { setEditing(undefined); setForm({ ...form, amount: '', note: '' }); }).catch(() => {});
  };
  // An archived category stays selectable only for the entry already filed under it.
  const options = report.categories.filter(category => category.isActive || category.id === form.categoryId).map(category => ({ value: category.id, label: category.isActive ? category.name : `${category.name} (archived)` }));
  return <Panel className="finance-management" title="Expenses and other revenue" subtitle="Each entry counts in the report on its own date.">
    <form className="finance-entry-form" onSubmit={submit}>
      <label><span>Entry type</span><SelectControl aria-label="Entry type" value={form.kind} onValueChange={value => setForm({ ...form, kind: value as FinanceEntry['kind'] })} options={[{ value: 'expense', label: 'Operating expense' }, { value: 'other_revenue', label: 'Other revenue' }]} /></label>
      {form.kind === 'expense' && <label><span>Expense category</span><SelectControl aria-label="Expense category" required value={form.categoryId} onValueChange={categoryId => setForm({ ...form, categoryId })} options={options} /></label>}
      <label><span>Date</span><InputControl aria-label="Entry date" type="date" required value={form.entryDate} onValueChange={entryDate => setForm({ ...form, entryDate })} /></label>
      <label><span>Amount ({report.company.currency})</span><InputControl aria-label="Entry amount" type="number" inputMode="decimal" required min="0.01" max="21474836.47" step="0.01" value={form.amount} onValueChange={amount => setForm({ ...form, amount })} /></label>
      <label className="finance-entry-note"><span>Note</span><InputControl aria-label="Entry note" maxLength={500} value={form.note} onValueChange={note => setForm({ ...form, note })} /></label>
      <div className="finance-entry-actions"><button className="button" disabled={busy || readOnly}>{editing ? 'Save changes' : 'Record entry'}</button>{editing && <button type="button" className="button secondary" onClick={() => { setEditing(undefined); setForm({ ...blank, kind: form.kind }); }}>Cancel</button>}</div>
      {invalid && <p className="form-error" role="alert">Enter an amount above zero with no more than two decimal places.</p>}
    </form>
    <div className="finance-entry-filter"><DateRangePicker allowAll value={range} onChange={setRange} label="Finance entry period" /></div>
    {loadError ? <p className="form-error" role="alert">Could not load entries. Try again.</p> : rows === null ? <EmptyState text="Loading entries" /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th className="num">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(entry => <tr key={entry.id}><td>{calendarDate(entry.entryDate)}</td><td>{entry.kind === 'other_revenue' ? 'Other Revenue' : report.categories.find(category => category.id === entry.categoryId)?.name}</td><td>{entry.note || '—'}</td><td className="num">{money(entry.amountCents)}</td><td className="finance-row-actions">{deleting === entry.id
      ? <><button type="button" className="text-button negative" disabled={busy || readOnly} onClick={() => { setDeleting(null); void remove(entry.id).catch(() => {}); }}>Confirm delete</button><button type="button" className="text-button" onClick={() => setDeleting(null)}>Keep</button></>
      : <><button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(entry.id); setForm({ kind: entry.kind, categoryId: entry.categoryId ?? blank.categoryId, entryDate: entry.entryDate, amount: (entry.amountCents / 100).toFixed(2), note: entry.note }); }}>Edit</button><button type="button" className="text-button negative" disabled={busy} onClick={() => setDeleting(entry.id)}>Delete</button></>}</td></tr>)}</tbody></table></div> : <EmptyState text="No entries in this period." />}
  </Panel>;
}

function CategoryEditor({ categories, busy, readOnly, save }: { categories: FinanceCategory[]; busy: boolean; readOnly: boolean; save: (body: { name: string; isActive: boolean }, id?: string) => Promise<void> }) {
  const [name, setName] = useState('');
  return <Panel className="finance-management" title="Expense categories" subtitle="Archived categories stop appearing in new entries but stay in reports that have amounts against them.">
    <form className="finance-category-row finance-category-add" onSubmit={event => { event.preventDefault(); void save({ name, isActive: true }).catch(() => {}); }}><InputControl aria-label="New category" placeholder="New category" required maxLength={80} value={name} onValueChange={setName} /><button className="button" disabled={busy || readOnly}>Add category</button></form>
    <div className="finance-category-list">{categories.map(category => <CategoryRow key={category.id} category={category} busy={busy} readOnly={readOnly} save={body => save(body, category.id)} />)}</div>
  </Panel>;
}

function CategoryRow({ category, busy, readOnly, save }: { category: FinanceCategory; busy: boolean; readOnly: boolean; save: (body: { name: string; isActive: boolean }) => Promise<void> }) {
  const [name, setName] = useState(category.name);
  return <form className={`finance-category-row ${category.isActive ? '' : 'is-archived'}`} onSubmit={event => { event.preventDefault(); void save({ name, isActive: category.isActive }).catch(() => {}); }}><InputControl aria-label={`Category name: ${category.name}`} required maxLength={80} value={name} onValueChange={setName} /><button className="button secondary" disabled={busy || readOnly || name.trim() === category.name}>Rename</button><button type="button" className="text-button" disabled={busy || readOnly} onClick={() => void save({ name: category.name, isActive: !category.isActive }).catch(() => {})}>{category.isActive ? 'Archive' : 'Restore'}</button></form>;
}
