export type CsvValue = string | number | boolean | null | undefined;

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function csvCell(value: CsvValue) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  // Spreadsheet programs can execute cells beginning with these characters as
  // formulas. User-controlled names, notes, and references must remain text.
  const safe = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
