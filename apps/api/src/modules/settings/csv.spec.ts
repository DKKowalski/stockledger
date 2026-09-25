import { describe, expect, it } from 'vitest';
import { toCsv } from './csv.js';

describe('toCsv', () => {
  it('escapes commas, quotes, and line breaks', () => {
    expect(toCsv(['Name', 'Note'], [['Rice, large', 'Said "hello"\nagain']]))
      .toBe('\uFEFFName,Note\r\n"Rice, large","Said ""hello""\nagain"\r\n');
  });

  it('keeps numbers machine readable and neutralizes spreadsheet formulas', () => {
    expect(toCsv(['SKU', 'Quantity'], [['=IMPORTXML("bad")', -4]]))
      .toBe('\uFEFFSKU,Quantity\r\n"\'=IMPORTXML(""bad"")",-4\r\n');
  });
});
