import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { Panel } from '../../components/inventory-ui';
import { DatePicker } from '../../components/ui/date-picker';
import { InputControl } from '../../components/ui/input-control';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { ProfitSplit, ProfitSplitPart } from './profit-split-types';

const MAX_PARTS = 10;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
const toBasisPoints = (text: string) => (PERCENT_PATTERN.test(text.trim()) ? Math.round(Number(text.trim()) * 100) : null);
const formatPercent = (percent: number) => `${percent}%`;

type Row = { key?: string; name: string; destination: string; percent: string };

// The split is a plan and a record only: nothing here moves money.
export function ProfitSplitSection({ accessToken, month, monthLabel, revision, readOnly, editing, onCloseEditor, onUnauthorized }: {
  accessToken: string; month: string; monthLabel: string; revision: number; readOnly: boolean; editing: boolean; onCloseEditor: () => void; onUnauthorized: () => void;
}) {
  const { money, calendarDate } = useCompanySettings();
  const [loaded, setSplit] = useState<ProfitSplit | null>(null);
  const split = loaded?.month === month ? loaded : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    void api.profitSplit(accessToken, month).then(result => { if (active) { setSplit(result); setError(null); } }).catch(caught => {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      else if (active) setError(safeErrorMessage(caught, 'Could not load the profit split'));
    });
    return () => { active = false; };
  }, [accessToken, month, revision, refresh, onUnauthorized]);

  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); toast.success(success); setRefresh(value => value + 1); return true; }
    catch (caught) { toast.error(safeErrorMessage(caught, 'Could not save the profit split')); return false; }
    finally { setBusy(false); }
  }, []);

  if (error) return <Panel className="profit-split" title="Profit split"><div role="alert" className="form-error"><p>{error}</p><button className="button secondary" type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div></Panel>;
  if (!split) return <Panel className="profit-split" title="Profit split"><p className="profit-split-empty" role="status">Loading profit split</p></Panel>;
  if (split.status === 'future' && !editing) return null;

  return <Panel className="profit-split" title="Profit split" subtitle={`${monthLabel}. A plan and a record only; it does not move any money.`}>
    {editing && <SettingsEditor split={split} busy={busy} readOnly={readOnly} onCancel={onCloseEditor} save={async parts => { if (await run(() => api.saveProfitSplitSettings(accessToken, parts), 'Profit split settings saved')) onCloseEditor(); }} />}
    {split.status !== 'future' && !split.hasProfit && <p className="profit-split-empty" role="status">No profit to split this month.</p>}
    {split.hasProfit && <>
      {split.isEstimate && <div className="finance-notice" role="status"><CircleAlert size={18} /><div><b>Estimate so far — the month isn&apos;t finished</b><span>Parts can be marked done once the month ends.</span></div></div>}
      <p className="profit-split-net">Net profit to split <strong>{money(split.netProfitCents)}</strong></p>
      <ul className="profit-split-list">{split.parts.map(part => <PartCard key={part.key} part={part} split={split} busy={busy} readOnly={readOnly} money={money} calendarDate={calendarDate}
        complete={body => run(() => api.completeProfitSplitPart(accessToken, month, part.key, body), `${part.name} marked done`)}
        undo={() => run(() => api.uncompleteProfitSplitPart(accessToken, month, part.key), `${part.name} marked not done`)} />)}</ul>
      <p className="profit-split-total">Total <strong>{money(split.parts.reduce((sum, part) => sum + part.amountCents, 0))}</strong></p>
    </>}
    {split.retired.length > 0 && <div className="profit-split-retired"><h3>Marked done under earlier settings</h3><ul>{split.retired.map(done => <li key={done.key}>{done.partName}, {money(done.amountCents)} ({formatPercent(done.percentBasisPoints / 100)}) on {calendarDate(done.doneOn)}</li>)}</ul></div>}
  </Panel>;
}

function PartCard({ part, split, busy, readOnly, money, calendarDate, complete, undo }: {
  part: ProfitSplitPart; split: ProfitSplit; busy: boolean; readOnly: boolean; money: (cents: number) => string; calendarDate: (value: string) => string;
  complete: (body: { doneOn: string; note: string }) => Promise<boolean>; undo: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [doneOn, setDoneOn] = useState(split.today);
  const [note, setNote] = useState('');
  const done = part.completion;
  const id = `split-${part.key}`;
  const submit = async (event: FormEvent) => { event.preventDefault(); if (await complete({ doneOn, note })) setOpen(false); };
  const disabled = busy || readOnly || (!split.canComplete && !done);
  return <li className="profit-split-card">
    <div className="profit-split-main"><div><b>{part.name}</b><span>{part.destination}</span></div><div className="profit-split-figures"><strong>{money(part.amountCents)}</strong><span>{formatPercent(part.percent)}</span></div></div>
    <label className="profit-split-done" htmlFor={id}>
      <input id={id} type="checkbox" checked={Boolean(done) || open} disabled={disabled} onChange={event => {
        if (event.target.checked) { setDoneOn(split.today); setNote(''); setOpen(true); } else if (done) void undo(); else setOpen(false);
      }} /><span>Done{done ? ` on ${calendarDate(done.doneOn)}` : ''}</span>
    </label>
    {done && done.note && <p className="profit-split-note">{done.note}</p>}
    {done?.changedSinceDone && <p className="profit-split-changed" role="status">Profit changed since this was marked done (was {money(done.amountCents)})</p>}
    {open && !done && <form className="profit-split-form" onSubmit={event => void submit(event)}>
      <label><span>Date done</span><DatePicker disabled={busy} label={`Date done for ${part.name}`} aria-label={`Date done for ${part.name}`} required value={doneOn} max={split.today} onValueChange={setDoneOn} /></label>
      <label><span>Note (optional)</span><InputControl disabled={busy} maxLength={200} value={note} onChange={event => setNote(event.target.value)} aria-label={`Note for ${part.name}`} /></label>
      <div className="profit-split-actions"><button className="button" disabled={busy || !doneOn}>{busy ? 'Saving…' : 'Save as done'}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
  </li>;
}

function SettingsEditor({ split, busy, readOnly, save, onCancel }: { split: ProfitSplit; busy: boolean; readOnly: boolean; save: (parts: Array<{ key?: string; name: string; destination: string; percent: number }>) => Promise<void>; onCancel: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => split.settings.map(part => ({ key: part.key, name: part.name, destination: part.destination, percent: String(part.percent) })));
  const points = rows.map(row => toBasisPoints(row.percent));
  const total = points.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const badPercent = points.some(value => value === null || value < 1 || value > 10_000);
  const blank = rows.some(row => !row.name.trim() || !row.destination.trim());
  const valid = !badPercent && !blank && total === 10_000 && rows.length >= 1 && rows.length <= MAX_PARTS;
  const update = (index: number, change: Partial<Row>) => setRows(current => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return <form className="profit-split-settings" onSubmit={event => { event.preventDefault(); if (valid) void save(rows.map((row, i) => ({ key: row.key, name: row.name.trim(), destination: row.destination.trim(), percent: points[i]! / 100 }))); }}>
    <h3>Profit split settings</h3>
    <p>Choose up to {MAX_PARTS} parts. Percents can have up to 2 decimals and must total exactly 100%. Changes apply to the plan; parts already marked done keep the amount they were saved with.</p>
    {rows.map((row, index) => <fieldset key={row.key ?? `new-${index}`} className="profit-split-row"><legend>Part {index + 1}</legend>
      <label><span>Name</span><InputControl disabled={busy} maxLength={80} value={row.name} onChange={event => update(index, { name: event.target.value })} /></label>
      <label><span>Destination</span><InputControl disabled={busy} maxLength={120} value={row.destination} onChange={event => update(index, { destination: event.target.value })} /></label>
      <label className="profit-split-percent"><span>Percent</span><InputControl disabled={busy} inputMode="decimal" value={row.percent} aria-invalid={points[index] === null} onChange={event => update(index, { percent: event.target.value })} /></label>
      <button className="button secondary" type="button" disabled={busy || rows.length <= 1} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove part {index + 1}</button>
    </fieldset>)}
    <button className="button secondary" type="button" disabled={busy || rows.length >= MAX_PARTS} onClick={() => setRows(current => [...current, { name: '', destination: '', percent: '' }])}>Add part</button>
    <p className={`profit-split-running ${total === 10_000 && !badPercent ? 'is-ok' : 'is-bad'}`} role="status">Total {total / 100}%{total === 10_000 && !badPercent ? '' : rows.some(row => !row.percent.trim()) ? ' — enter a percent for every part' : badPercent ? ' — use percents above 0 with up to 2 decimals' : ' — must be exactly 100%'}</p>
    <div className="profit-split-actions"><button className="button" disabled={busy || readOnly || !valid}>{busy ? 'Saving…' : 'Save settings'}</button><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
