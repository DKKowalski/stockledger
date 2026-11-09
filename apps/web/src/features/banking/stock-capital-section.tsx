import { CircleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { DatePicker } from '../../components/ui/date-picker';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { ProfitSplit } from './profit-split-types';

// Stock capital: the month's Cost of Goods Sold, i.e. the money that came back from selling stock and
// must be set aside to restock. It is banked on its own and is not part of the profit split.
export function StockCapitalSection({ accessToken, month, split, readOnly, onChanged, reload }: {
  accessToken: string; month: string; split: ProfitSplit | null; readOnly: boolean; onChanged: () => void; reload: () => void;
}) {
  const { money, calendarDate } = useCompanySettings();
  const [open, setOpen] = useState(false);
  const [doneOn, setDoneOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!split || split.status === 'future') return null;
  const capital = split.capital;
  const done = capital.completion;
  const hasStock = capital.amountCents > 0;
  const disabled = busy || readOnly || (!capital.canComplete && !done);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); toast.success(success); reload(); onChanged(); return true; }
    catch (caught) { toast.error(safeErrorMessage(caught, 'Could not save stock capital')); return false; }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => api.completeStockCapital(accessToken, month, { doneOn, note }), 'Stock capital marked done')) setOpen(false);
  };

  return <Card role="region" className="stock-capital mt-4" aria-labelledby="stock-capital-title">
    <CardHeader>
      <CardTitle id="stock-capital-title"><h2 className="text-base font-semibold">Stock capital</h2></CardTitle>
      <CardDescription>What the stock you sold cost you. Bank it to restock — it isn&apos;t profit.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3">
      {!hasStock && !done && <p className="text-sm text-muted-foreground" role="status">No stock sold this month.</p>}
      {(hasStock || done) && <>
        {capital.isEstimate && <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm" role="status"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><div className="grid"><b>Estimate so far</b><span className="text-muted-foreground">The month isn&apos;t finished, so it can be marked done once it ends.</span></div></div>}
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5"><b className="text-sm">Capital account (restock)</b><span className="text-xs text-muted-foreground">Cost of goods sold in this month</span></div>
          <strong className="shrink-0 text-base tabular-nums" data-testid="stock-capital-amount">{money(capital.amountCents)}</strong>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="stock-capital-done" className="size-6" checked={Boolean(done) || open} disabled={disabled} onCheckedChange={checked => {
            if (checked) { setDoneOn(split.today); setNote(''); setOpen(true); } else if (done) void run(() => api.uncompleteStockCapital(accessToken, month), 'Stock capital marked not done'); else setOpen(false);
          }} />
          <Label htmlFor="stock-capital-done" className="text-sm">Done{done ? ` on ${calendarDate(done.doneOn)}` : ''}</Label>
        </div>
        {done?.note && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{done.note}</p>}
        {done?.changedSinceDone && <p className="rounded-lg bg-muted p-2 text-xs" role="status">Changed since this was marked done (was {money(done.amountCents)})</p>}
        {open && !done && <form className="grid gap-3" onSubmit={event => void submit(event)}>
          <div className="grid gap-1.5"><Label>Date done</Label><DatePicker disabled={busy} label="Date done for stock capital" aria-label="Date done for stock capital" required value={doneOn} max={split.today} onValueChange={setDoneOn} /></div>
          <div className="grid gap-1.5"><Label htmlFor="stock-capital-note">Note (optional)</Label><Input id="stock-capital-note" className="h-11" disabled={busy} maxLength={200} value={note} onChange={event => setNote(event.target.value)} aria-label="Note for stock capital" /></div>
          <div className="flex flex-wrap gap-2.5">
            <Button type="submit" className="h-11 px-4" disabled={busy || !doneOn}>{busy ? 'Saving…' : 'Save as done'}</Button>
            <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>}
      </>}
    </CardContent>
  </Card>;
}
