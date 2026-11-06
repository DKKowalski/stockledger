import { useId, useState, type KeyboardEvent } from 'react';
import { useCompanySettings } from '../../app/company-settings-store';
import type { DatePreset, DateRangeValue } from '../../lib/date-range';
import { companyDay, presetRange, rangeQuery } from '../../lib/date-range';
import { InputControl } from './input-control';
import { SelectControl } from './select-control';

// The one period control: presets plus a calendar start and end. Both dates are inclusive business days.
const NAMED_PRESETS: readonly string[] = ['today', 'this_month', 'last_month'];

export function DateRangePicker({ value, onChange, allowAll = false, label = 'Reporting period', visibleLabel }: { value: DateRangeValue; onChange: (value: DateRangeValue) => void; allowAll?: boolean; label?: string; visibleLabel?: string }) {
  const { settings } = useCompanySettings();
  const id = useId();
  const initial = rangeQuery(value, settings?.timeZone);
  const today = companyDay(settings?.timeZone);
  const [custom, setCustom] = useState(Boolean(value.from) && !value.preset);
  const [from, setFrom] = useState(initial.from ?? today);
  const [to, setTo] = useState(initial.to ?? today);
  const missing = !from || !to;
  const backwards = !missing && to < from;
  const invalid = missing || backwards;
  const unchanged = !value.preset && value.from === from && value.to === to;
  const apply = () => { if (!invalid) onChange({ days: value.days, from, to }); };
  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } };
  const presets = [{ value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' }];
  const choose = (preset: string) => {
    if (preset === 'custom') {
      setCustom(true);
      const current = rangeQuery(value, settings?.timeZone);
      if (current.from && current.to) { setFrom(current.from); setTo(current.to); }
    } else {
      setCustom(false);
      if (NAMED_PRESETS.includes(preset)) onChange({ days: value.days, preset: preset as DatePreset, ...presetRange(preset as DatePreset, settings?.timeZone) });
      else onChange({ days: preset === 'all' ? null : Number(preset) });
    }
  };
  const select = <SelectControl aria-label={label} value={custom ? 'custom' : value.preset ?? (value.days === null ? 'all' : String(value.days))} options={[...(allowAll ? [{ value: 'all', label: 'All dates' }] : []), ...presets, { value: 'custom', label: 'Custom dates' }]} onValueChange={choose} />;
  return <div className={`date-range-picker ${custom ? 'is-custom' : ''}`} role="group" aria-label={label}>
    {visibleLabel ? <div className="date-range-preset"><span>{visibleLabel}</span>{select}</div> : select}
    {custom && <div className="date-range-fields">
      <label><span>Start date</span><InputControl type="date" value={from} max={to || undefined} onValueChange={setFrom} onKeyDown={applyOnEnter} aria-invalid={invalid} aria-describedby={invalid ? id : undefined} /></label>
      <label><span>End date</span><InputControl type="date" value={to} min={from || undefined} onValueChange={setTo} onKeyDown={applyOnEnter} aria-invalid={invalid} aria-describedby={invalid ? id : undefined} /></label>
      <button className="button secondary" type="button" disabled={invalid || unchanged} onClick={apply}>Apply dates</button>
      {invalid && <small id={id} className="date-range-error" role="alert">{backwards ? 'The end date must be on or after the start date.' : 'Choose a start and an end date.'}</small>}
    </div>}
  </div>;
}
