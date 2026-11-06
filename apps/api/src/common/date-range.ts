import { BadRequestException } from '@nestjs/common';
import { IsDateString, IsOptional, Matches } from 'class-validator';

const FIRST_YEAR = 1900;
const LAST_YEAR = 2199;
// Offsets run from UTC-12 to UTC+14, so a local midnight is always within 15 hours of the same UTC midnight.
const MAX_OFFSET_MS = 15 * 60 * 60 * 1000;

export class DateRangeDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export function calendarDay(value: Date | string, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function dateRange(query: { from?: string; to?: string }, days?: number, timeZone = 'UTC', now = new Date()) {
  if (Boolean(query.from) !== Boolean(query.to)) throw new BadRequestException('Choose both a start and end date');
  for (const value of [query.from, query.to]) {
    if (value && !isCalendarDate(value)) throw new BadRequestException('Use valid calendar dates');
  }
  if (query.from && query.to) {
    if (query.from > query.to) throw new BadRequestException('End date must be on or after start date');
    return { from: query.from, to: query.to };
  }
  if (days === undefined) return null;
  const to = calendarDay(now, timeZone);
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return { from: start.toISOString().slice(0, 10), to };
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < FIRST_YEAR || year > LAST_YEAR) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// The first instant of a local day. Some zones skip midnight when clocks change, so search for it.
function startOfDay(day: string, format: Intl.DateTimeFormat) {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  let before = midnight - MAX_OFFSET_MS;
  let atOrAfter = midnight + MAX_OFFSET_MS;
  while (atOrAfter - before > 1) {
    const middle = Math.floor((before + atOrAfter) / 2);
    if (format.format(new Date(middle)) >= day) atOrAfter = middle;
    else before = middle;
  }
  return new Date(atOrAfter).toISOString();
}

export function timestampBounds(range: { from: string; to: string }, timeZone = 'UTC') {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const nextDay = new Date(`${range.to}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { from: startOfDay(range.from, format), toExclusive: startOfDay(nextDay.toISOString().slice(0, 10), format) };
}
