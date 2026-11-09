import { CircleAlert } from 'lucide-react';
import { useCallback, useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { DatePicker } from '../../components/ui/date-picker';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Separator } from '../../components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { safeErrorMessage } from '../../lib/user-facing-error';
import { BankingCard } from './banking-card';
import type { ProfitSplit, ProfitSplitPart } from './profit-split-types';

const MAX_PARTS = 10;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
const toBasisPoints = (text: string) => (PERCENT_PATTERN.test(text.trim()) ? Math.round(Number(text.trim()) * 100) : null);
const formatPercent = (percent: number) => `${percent}%`;

type Row = { key?: string; name: string; destination: string; percent: string };

// The split is a plan and a record only: nothing here moves money.
export function ProfitSplitSection({ accessToken, month, monthLabel, split, error, reload, readOnly, editing, onCloseEditor, onChanged }: {
  accessToken: string; month: string; monthLabel: string; split: ProfitSplit | null; error: string | null; reload: () => void; onChanged: () => void; readOnly: boolean; editing: boolean; onCloseEditor: () => void;
}) {
  const { money, calendarDate } = useCompanySettings();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); toast.success(success); reload(); onChanged(); return true; }
    catch (caught) { toast.error(safeErrorMessage(caught, 'Could not save the profit split')); return false; }
    finally { setBusy(false); }
  }, [onChanged, reload]);

  if (error) return <BankingCard className="profit-split mt-4" title="Profit split"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription><div className="mt-2"><Button type="button" variant="outline" className="h-11 px-4" onClick={reload}>Retry</Button></div></Alert></BankingCard>;
  if (!split) return <BankingCard className="profit-split mt-4" title="Profit split"><p className="text-sm text-muted-foreground" role="status">Loading profit split</p></BankingCard>;

  const editor = <Sheet open={editing} onOpenChange={open => { if (!open) onCloseEditor(); }}>
    <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
      {editing && <SettingsEditor split={split} busy={busy} readOnly={readOnly} onCancel={onCloseEditor} save={async parts => { if (await run(() => api.saveProfitSplitSettings(accessToken, parts), 'Profit split settings saved')) onCloseEditor(); }} />}
    </SheetContent>
  </Sheet>;
  if (split.status === 'future') return editor;

  return <>
    <BankingCard className="profit-split mt-4" title="Profit split" description={`${monthLabel}. A plan and a record only; it does not move any money.`}>
      {!split.hasProfit && <p className="text-sm text-muted-foreground" role="status">No profit to split this month.</p>}
      {split.hasProfit && <>
        {split.isEstimate && <Alert role="status"><CircleAlert aria-hidden /><AlertTitle>Estimate so far — the month isn&apos;t finished</AlertTitle><AlertDescription>Parts can be marked done once the month ends.</AlertDescription></Alert>}
        <p className="profit-split-net flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">Net profit to split <strong className="text-xl tabular-nums text-foreground">{money(split.netProfitCents)}</strong></p>
        <ul className="grid gap-2.5">{split.parts.map(part => <PartCard key={part.key} part={part} split={split} busy={busy} readOnly={readOnly} money={money} calendarDate={calendarDate}
          complete={body => run(() => api.completeProfitSplitPart(accessToken, month, part.key, body), `${part.name} marked done`)}
          undo={() => run(() => api.uncompleteProfitSplitPart(accessToken, month, part.key), `${part.name} marked not done`)} />)}</ul>
        <Separator />
        <p className="profit-split-total flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">Total <strong className="text-xl tabular-nums text-foreground">{money(split.parts.reduce((sum, part) => sum + part.amountCents, 0))}</strong></p>
      </>}
      {split.retired.length > 0 && <div className="grid gap-1.5 text-sm text-muted-foreground"><h3 className="text-sm font-semibold text-foreground">Marked done under earlier settings</h3><ul className="list-disc pl-5">{split.retired.map(done => <li key={done.key}>{done.partName}, {money(done.amountCents)} ({formatPercent(done.percentBasisPoints / 100)}) on {calendarDate(done.doneOn)}</li>)}</ul></div>}
    </BankingCard>
    {editor}
  </>;
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
    <Card size="sm" className="gap-2 py-3.5">
      <div className="flex items-start justify-between gap-3 px-3.5">
        <div className="grid min-w-0 gap-0.5"><b className="text-sm [overflow-wrap:anywhere]">{part.name}</b><span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{part.destination}</span></div>
        <div className="grid shrink-0 justify-items-end gap-0.5"><strong className="text-base tabular-nums">{money(part.amountCents)}</strong><span className="text-xs text-muted-foreground">{formatPercent(part.percent)}</span></div>
      </div>
      <div className="flex min-h-11 items-center gap-3 px-3.5">
        <Checkbox id={id} className="size-6" checked={Boolean(done) || open} disabled={disabled} onCheckedChange={checked => {
          if (checked) { setDoneOn(split.today); setNote(''); setOpen(true); } else if (done) void undo(); else setOpen(false);
        }} />
        <Label htmlFor={id} className="text-sm">Done{done ? ` on ${calendarDate(done.doneOn)}` : ''}</Label>
      </div>
      {done?.note && <p className="px-3.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{done.note}</p>}
      {done?.changedSinceDone && <p className="mx-3.5 rounded-lg bg-muted p-2 text-xs" role="status">Profit changed since this was marked done (was {money(done.amountCents)})</p>}
      {open && !done && <form className="grid gap-3 px-3.5" onSubmit={event => void submit(event)}>
        <div className="grid gap-1.5"><Label>Date done</Label><DatePicker disabled={busy} label={`Date done for ${part.name}`} aria-label={`Date done for ${part.name}`} required value={doneOn} max={split.today} onValueChange={setDoneOn} /></div>
        <div className="grid gap-1.5"><Label htmlFor={`${id}-note`}>Note (optional)</Label><Input id={`${id}-note`} className="h-11" disabled={busy} maxLength={200} value={note} onChange={event => setNote(event.target.value)} aria-label={`Note for ${part.name}`} /></div>
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" className="h-11 px-4" disabled={busy || !doneOn}>{busy ? 'Saving…' : 'Save as done'}</Button>
          <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>}
    </Card>
  </li>;
}

function SettingsEditor({ split, busy, readOnly, save, onCancel }: { split: ProfitSplit; busy: boolean; readOnly: boolean; save: (parts: Array<{ key?: string; name: string; destination: string; percent: number }>) => Promise<void>; onCancel: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => split.settings.map(part => ({ key: part.key, name: part.name, destination: part.destination, percent: String(part.percent) })));
  const uid = useId();
  const points = rows.map(row => toBasisPoints(row.percent));
  const total = points.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const badPercent = points.some(value => value === null || value < 1 || value > 10_000);
  const blank = rows.some(row => !row.name.trim() || !row.destination.trim());
  const valid = !badPercent && !blank && total === 10_000 && rows.length >= 1 && rows.length <= MAX_PARTS;
  const totalOk = total === 10_000 && !badPercent;
  const update = (index: number, change: Partial<Row>) => setRows(current => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return <form className="profit-split-settings flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); if (valid) void save(rows.map((row, i) => ({ key: row.key, name: row.name.trim(), destination: row.destination.trim(), percent: points[i]! / 100 }))); }}>
    <SheetHeader>
      <SheetTitle>Profit split settings</SheetTitle>
      <SheetDescription>Choose up to {MAX_PARTS} parts. Percents can have up to 2 decimals and must total exactly 100%. Changes apply to the plan; parts already marked done keep the amount they were saved with.</SheetDescription>
    </SheetHeader>
    <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 pb-4">
      {rows.map((row, index) => <fieldset key={row.key ?? `new-${index}`} className="profit-split-row grid min-w-0 gap-2.5 rounded-xl border border-border p-3"><legend className="px-1.5 text-xs text-muted-foreground">Part {index + 1}</legend>
        <div className="grid gap-1.5"><Label htmlFor={`${uid}-${index}-name`}>Name</Label><Input id={`${uid}-${index}-name`} className="h-11" disabled={busy} maxLength={80} value={row.name} onChange={event => update(index, { name: event.target.value })} /></div>
        <div className="grid gap-1.5"><Label htmlFor={`${uid}-${index}-destination`}>Destination</Label><Input id={`${uid}-${index}-destination`} className="h-11" disabled={busy} maxLength={120} value={row.destination} onChange={event => update(index, { destination: event.target.value })} /></div>
        <div className="grid gap-1.5"><Label htmlFor={`${uid}-${index}-percent`}>Percent</Label><Input id={`${uid}-${index}-percent`} className="h-11" disabled={busy} inputMode="decimal" value={row.percent} aria-invalid={points[index] === null} onChange={event => update(index, { percent: event.target.value })} /></div>
        <Button type="button" variant="outline" className="h-11 justify-self-start px-4" disabled={busy || rows.length <= 1} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove part {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="outline" className="h-11 justify-self-start px-4" disabled={busy || rows.length >= MAX_PARTS} onClick={() => setRows(current => [...current, { name: '', destination: '', percent: '' }])}>Add part</Button>
      <p className={`text-sm font-semibold ${totalOk ? 'text-success' : 'text-destructive'}`} role="status">Total {total / 100}%{totalOk ? '' : rows.some(row => !row.percent.trim()) ? ' — enter a percent for every part' : badPercent ? ' — use percents above 0 with up to 2 decimals' : ' — must be exactly 100%'}</p>
    </div>
    <SheetFooter className="flex-row flex-wrap border-t border-border">
      <Button type="submit" className="h-11 px-4" disabled={busy || readOnly || !valid}>{busy ? 'Saving…' : 'Save settings'}</Button>
      <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onCancel}>Cancel</Button>
    </SheetFooter>
  </form>;
}
