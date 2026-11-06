import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { calendarDay, dateRange, DateRangeDto, timestampBounds } from './date-range.js';

describe('business date ranges', () => {
  it.each([{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-03-02', to: '2026-03-01' }, { from: '2026-03-02' }, { to: '2026-03-02' }, { from: '2026-03-01T00:00:00Z', to: '2026-03-02' }])('rejects invalid or incomplete ranges: %j', query => {
    expect(() => dateRange(query)).toThrow();
  });
  it('accepts a single inclusive calendar day', () => expect(dateRange({ from: '2026-03-01', to: '2026-03-01' })).toEqual({ from: '2026-03-01', to: '2026-03-01' }));
  it('includes 23:30 on the end day in the company timezone and excludes the next day over DST', () => {
    expect(calendarDay('2026-03-09T03:30:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(calendarDay('2026-03-09T04:00:00Z', 'America/New_York')).toBe('2026-03-09');
    expect(calendarDay('2026-11-02T04:30:00Z', 'America/New_York')).toBe('2026-11-01');
  });
  it('uses a half-open timestamp range covering the entire local final day across DST', () => {
    expect(timestampBounds({ from: '2026-03-08', to: '2026-03-08' }, 'America/New_York')).toEqual({ from: '2026-03-08T05:00:00.000Z', toExclusive: '2026-03-09T04:00:00.000Z' });
    expect(timestampBounds({ from: '2026-11-01', to: '2026-11-01' }, 'America/New_York')).toEqual({ from: '2026-11-01T04:00:00.000Z', toExclusive: '2026-11-02T05:00:00.000Z' });
  });
  it('finds the start of a day whose midnight is skipped by daylight saving', () => {
    expect(timestampBounds({ from: '2026-03-08', to: '2026-03-07' }, 'America/Havana').from).toBe('2026-03-08T05:00:00.000Z');
    expect(timestampBounds({ from: '2026-03-07', to: '2026-03-07' }, 'America/Havana').toExclusive).toBe('2026-03-08T05:00:00.000Z');
  });
  it('rejects years outside the supported range instead of failing later', () => {
    expect(() => dateRange({ from: '2026-01-01', to: '9999-12-31' })).toThrow('valid calendar dates');
  });
  it('calculates preset boundaries in the company timezone', () => expect(dateRange({}, 7, 'America/New_York', new Date('2026-01-01T01:00:00Z'))).toEqual({ from: '2025-12-24', to: '2025-12-31' }));
  it('validates query DTO calendar dates before they reach services', async () => expect(await validate(plainToInstance(DateRangeDto, { from: '2026-02-30', to: 'x' }))).toHaveLength(2));
});
