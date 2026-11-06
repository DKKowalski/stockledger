import { calendarDateValue, parseCalendarDate } from './calendar-date';

export type DatePreset = 'today' | 'this_month' | 'last_month';
// A named preset is resolved to dates when picked, and keeps its name so the picker can show it.
export type DateRangeValue = { days: number | null; from?: string; to?: string; preset?: DatePreset };

export function companyDay(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function presetRange(preset: DatePreset, timeZone?: string, now = new Date()) {
  const today = companyDay(timeZone, now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today };
  const lastDay = parseCalendarDate(`${today.slice(0, 7)}-01`)!;
  lastDay.setDate(0);
  const to = calendarDateValue(lastDay);
  return { from: `${to.slice(0, 7)}-01`, to };
}

export function rangeQuery(value: DateRangeValue, timeZone?: string): { from?: string; to?: string } {
  if (value.from && value.to) return { from: value.from, to: value.to };
  if (value.days === null) return {};
  const to = companyDay(timeZone);
  const start = parseCalendarDate(to)!;
  start.setDate(start.getDate() - value.days);
  return { from: calendarDateValue(start), to };
}
