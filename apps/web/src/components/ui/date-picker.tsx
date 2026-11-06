import { Popover } from '@base-ui/react/popover';
import { CalendarDays } from 'lucide-react';
import { useId, useRef, useState, type AriaAttributes } from 'react';
import { useCompanySettings } from '../../app/company-settings-store';
import { companyDay } from '../../lib/date-range';
import { calendarDateValue, formatCalendarDate, parseCalendarDate } from '../../lib/calendar-date';
import { Calendar, CalendarPopup } from './calendar';

type DatePickerProps = AriaAttributes & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  id?: string;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
};

export function DatePicker({ label, value, onValueChange, name, id, required, min, max, disabled, placeholder = 'Choose a date', ...aria }: DatePickerProps) {
  const { settings } = useCompanySettings();
  const errorId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const date = parseCalendarDate(value);
  const error = !value ? (required ? `Choose ${label.toLowerCase()}.` : '') : !date ? 'Choose a valid date.' : min && value < min ? `Choose a date on or after ${formatCalendarDate(min)}.` : max && value > max ? `Choose a date on or before ${formatCalendarDate(max)}.` : '';
  const display = formatCalendarDate(value) || placeholder;
  const change = (next: string) => { onValueChange(next); setAttempted(false); setOpen(false); };
  return <span className="date-picker-field">
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger ref={trigger} id={id} type="button" className="select-trigger date-trigger" disabled={disabled} {...aria} aria-label={`${aria['aria-label'] ?? label}: ${display}`} aria-invalid={aria['aria-invalid'] || (attempted && !!error) || undefined} aria-describedby={[aria['aria-describedby'], attempted && error ? errorId : ''].filter(Boolean).join(' ') || undefined}>
        <span className={date ? 'select-value' : 'select-value date-placeholder'}>{display}</span><CalendarDays size={17} aria-hidden="true" />
      </Popover.Trigger>
      <CalendarPopup returnFocus={trigger} label={`Choose ${label.toLowerCase()}`} footer={!required ? <div className="calendar-footer"><button type="button" className="button secondary" onClick={() => change('')}>Clear date</button></div> : undefined}>
        <Calendar mode="single" selected={date} defaultMonth={date ?? parseCalendarDate(companyDay(settings?.timeZone))} required={required} startMonth={min ? parseCalendarDate(min) : new Date(1900, 0)} endMonth={max ? parseCalendarDate(max) : new Date(Number(companyDay(settings?.timeZone).slice(0, 4)) + 20, 11)} disabled={[...(min ? [{ before: parseCalendarDate(min)! }] : []), ...(max ? [{ after: parseCalendarDate(max)! }] : [])]} onSelect={(_selected: Date | undefined, day: Date) => change(calendarDateValue(day))} />
      </CalendarPopup>
    </Popover.Root>
    {/* A text proxy participates in native form validation and FormData without exposing a device date UI. */}
    <input className="date-validation-input" aria-hidden="true" tabIndex={-1} type="text" name={name} value={value} required={required} disabled={disabled} onChange={event => onValueChange(event.target.value)} ref={node => { node?.setCustomValidity(error); }} onInvalid={event => { event.preventDefault(); setAttempted(true); trigger.current?.focus(); }} />
    {attempted && error && <small className="date-range-error" id={errorId} role="alert">{error}</small>}
  </span>;
}
