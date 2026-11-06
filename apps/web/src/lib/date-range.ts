export type DateRangeValue = { days: number | null; from?: string; to?: string };

export function companyDay(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function rangeQuery(value: DateRangeValue, timeZone?: string): { from?: string; to?: string } {
  if (value.from && value.to) return { from: value.from, to: value.to };
  if (value.days === null) return {};
  const to = companyDay(timeZone);
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - value.days);
  return { from: start.toISOString().slice(0, 10), to };
}
