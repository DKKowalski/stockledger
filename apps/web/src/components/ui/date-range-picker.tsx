import { useId, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { CalendarDays } from 'lucide-react';
import { formatCalendarDate } from '../../lib/calendar-date';
import { CalendarPopup } from './calendar';
import { CalendarRange } from './calendar-range';
import { useCompanySettings } from '../../app/company-settings-store';
import type { DatePreset, DateRangeValue } from '../../lib/date-range';
import { companyDay, presetRange, rangeQuery } from '../../lib/date-range';
import { SelectControl } from './select-control';

// Presets apply immediately; custom calendar dates apply only on confirmation.
const NAMED_PRESETS: readonly string[] = ['today', 'this_month', 'last_month'];

export function DateRangePicker({ value, onChange, allowAll = false, label = 'Reporting period', visibleLabel }: { value: DateRangeValue; onChange: (value: DateRangeValue) => void; allowAll?: boolean; label?: string; visibleLabel?: string }) {
  const { settings } = useCompanySettings();
  const id = useId();
  const openAfterPreset = useRef(false);
  const customTrigger = useRef<HTMLButtonElement>(null);
  const presetScroll = useRef({ x: 0, y: 0 });
  const initial = rangeQuery(value, settings?.timeZone);
  const today = companyDay(settings?.timeZone);
  const [custom, setCustom] = useState(Boolean(value.from) && !value.preset);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(initial.from ?? today);
  const [to, setTo] = useState(initial.to ?? today);
  const missing = !from || !to;
  const backwards = !missing && to < from;
  const invalid = missing || backwards;
  const unchanged = !value.preset && value.from === from && value.to === to;
  const apply = () => { if (!invalid) { onChange({ days: value.days, from, to }); setOpen(false); } };
  const showCalendar = (next: boolean) => {
    if (next) { const current = rangeQuery(value, settings?.timeZone); setFrom(current.from ?? today); setTo(current.to ?? today); }
    setOpen(next);
  };
  const presets = [{ value: 'today', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' }];
  const choose = (preset: string) => {
    if (preset === 'custom') {
      setCustom(true);
      // Wait for the preset popup to close before handing focus to the calendar.
      openAfterPreset.current = true;
    } else {
      openAfterPreset.current = false;
      setCustom(false);
      setOpen(false);
      if (NAMED_PRESETS.includes(preset)) onChange({ days: value.days, preset: preset as DatePreset, ...presetRange(preset as DatePreset, settings?.timeZone) });
      else onChange({ days: preset === 'all' ? null : Number(preset) });
    }
  };
  const select = <SelectControl onOpenChange={open => { if (open) presetScroll.current = { x: window.scrollX, y: window.scrollY }; }} onOpenChangeComplete={open => {
    if (open || !openAfterPreset.current) return;
    requestAnimationFrame(() => {
      if (!openAfterPreset.current || !customTrigger.current) return;
      openAfterPreset.current = false;
      // Expanding the filter must not anchor the page to the departing preset menu.
      window.scrollTo(presetScroll.current.x, presetScroll.current.y);
      const box = customTrigger.current.getBoundingClientRect();
      if (box.top < 76) window.scrollBy(0, box.top - 88);
      else if (box.bottom > window.innerHeight) window.scrollBy(0, box.bottom - window.innerHeight + 12);
      showCalendar(true);
    });
  }} aria-label={label} value={custom ? 'custom' : value.preset ?? (value.days === null ? 'all' : String(value.days))} options={[...(allowAll ? [{ value: 'all', label: 'All dates' }] : []), ...presets, { value: 'custom', label: 'Custom dates' }]} onValueChange={choose} />;
  return <div className={`date-range-picker ${custom ? 'is-custom' : ''}`} role="group" aria-label={label}>
    {visibleLabel ? <div className="date-range-preset"><span>{visibleLabel}</span>{select}</div> : select}
    {custom && <div className="date-range-fields">
      <span className="date-range-field"><span>Start date – End date</span><Popover.Root open={open} onOpenChange={showCalendar}>
        <Popover.Trigger ref={customTrigger} className="select-trigger date-trigger" type="button" aria-label={`${label}: ${formatCalendarDate(initial.from ?? today)} – ${formatCalendarDate(initial.to ?? today)}`}><span className="select-value">{formatCalendarDate(initial.from ?? today)} – {formatCalendarDate(initial.to ?? today)}</span><CalendarDays size={17} aria-hidden="true" /></Popover.Trigger>
        <CalendarPopup returnFocus={customTrigger} label={`${label} calendar`} footer={<div className="calendar-footer"><Popover.Close className="button secondary" type="button">Cancel</Popover.Close><button className="button" type="button" aria-describedby={invalid ? id : undefined} disabled={invalid || unchanged} onClick={apply}>Apply dates</button></div>}>
          <CalendarRange errorId={id} from={from} to={to} onChange={(start, end) => { setFrom(start); setTo(end); }} />
          {invalid && <p id={id} className="date-range-error" role="alert">{backwards ? 'The end date must be on or after the start date.' : 'Choose a start and an end date.'}</p>}
        </CalendarPopup>
      </Popover.Root></span>
    </div>}
  </div>;
}
