import { useState } from 'react';
import { calendarDateValue, formatCalendarDate, parseCalendarDate } from '../../lib/calendar-date';
import { Calendar } from './calendar';

// Keep the clicked order so a backwards end date is explained rather than silently swapped.
export function CalendarRange({ from, to, onChange, errorId }: { from: string; to: string; errorId?: string; onChange: (from: string, to: string) => void }) {
  const [choosingEnd, setChoosingEnd] = useState(false);
  const backwards = !!from && !!to && to < from;
  return <>
    <p className="calendar-instruction" aria-live="polite">{choosingEnd ? 'Choose an end date.' : 'Choose a start date, then an end date.'}</p>
    <Calendar range aria-invalid={!from || !to || backwards || undefined} aria-describedby={!from || !to || backwards ? errorId : undefined} mode="range" defaultMonth={parseCalendarDate(from)} selected={from ? { from: parseCalendarDate(from), to: backwards ? undefined : parseCalendarDate(to) } : undefined} onSelect={(_range, day) => {
      const next = calendarDateValue(day);
      if (!choosingEnd) { onChange(next, ''); setChoosingEnd(true); }
      else { onChange(from, next); if (next >= from) setChoosingEnd(false); }
    }} />
    <div className="calendar-range-summary" aria-live="polite"><span><small>Start date</small><strong>{formatCalendarDate(from) || 'Choose a date'}</strong></span><span><small>End date</small><strong>{formatCalendarDate(to) || 'Choose a date'}</strong></span></div>
  </>;
}
