export type SpreadsheetItem = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  unitCostCents: number;
  sellingPriceCents?: number;
  openingStock: number;
};

type Cell = string | number | boolean | Date | null | undefined;

const columnAliases: Record<string, keyof SpreadsheetItem> = {
  sku: 'sku',
  name: 'name',
  item_name: 'name',
  category: 'category',
  unit: 'unit',
  reorder_level: 'reorderLevel',
  reorder: 'reorderLevel',
  unit_cost: 'unitCostCents',
  cost: 'unitCostCents',
  selling_price: 'sellingPriceCents',
  price: 'sellingPriceCents',
  opening_stock: 'openingStock',
  quantity: 'openingStock',
};

export async function readInventorySpreadsheet(file: File): Promise<SpreadsheetItem[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const data = extension === 'csv'
    ? parseCsv(await file.text())
    : extension === 'xlsx'
      ? await readXlsx(file)
      : null;
  if (!data) throw new Error('Choose an .xlsx or .csv spreadsheet');
  return parseInventoryRows(data);
}

async function readXlsx(file: File) {
  const { readSheet } = await import('read-excel-file/browser');
  return await readSheet(file) as Cell[][];
}

export function parseInventoryRows(data: Cell[][]): SpreadsheetItem[] {
  if (data.length < 2) throw new Error('The spreadsheet needs a header row and at least one item');
  const headers = data[0]!.map((cell) => normalizeHeader(cell));
  const columns = headers.map((header) => columnAliases[header]);
  if (!columns.includes('sku') || !columns.includes('name')) {
    throw new Error('The header row must include SKU and Name columns');
  }

  const dataRows = data.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''));
  if (!dataRows.length) throw new Error('No inventory rows were found');
  if (dataRows.length > 200) throw new Error('Import up to 200 items at a time');

  const seen = new Map<string, number>();
  return dataRows.map((row, index) => {
    const spreadsheetRow = index + 2;
    const record = Object.fromEntries(columns.flatMap((key, columnIndex) => key ? [[key, row[columnIndex]]] : [])) as Partial<Record<keyof SpreadsheetItem, Cell>>;
    const sku = text(record.sku).toUpperCase();
    const name = text(record.name);
    if (!sku) throw new Error(`Row ${spreadsheetRow}: SKU is required`);
    if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(sku)) throw new Error(`Row ${spreadsheetRow}: SKU can use letters, numbers, dots, dashes and underscores`);
    if (!name) throw new Error(`Row ${spreadsheetRow}: Name is required`);
    if (seen.has(sku)) throw new Error(`Rows ${seen.get(sku)} and ${spreadsheetRow} use the same SKU ${sku}`);
    seen.set(sku, spreadsheetRow);

    const sellingPrice = optionalMoney(record.sellingPriceCents, spreadsheetRow, 'Selling price');
    return {
      sku,
      name,
      category: text(record.category) || 'General',
      unit: text(record.unit) || 'pcs',
      reorderLevel: wholeNumber(record.reorderLevel, spreadsheetRow, 'Reorder level'),
      unitCostCents: money(record.unitCostCents, spreadsheetRow, 'Unit cost'),
      ...(sellingPrice === undefined ? {} : { sellingPriceCents: sellingPrice }),
      openingStock: wholeNumber(record.openingStock, spreadsheetRow, 'Opening stock'),
    };
  });
}

export const inventoryTemplate = [
  ['SKU', 'Name', 'Category', 'Unit', 'Reorder level', 'Unit cost', 'Selling price', 'Opening stock'],
  ['SKU-1001', 'Basmati Rice 5kg', 'Grocery', 'bag', '20', '12.50', '18.00', '80'],
];

function normalizeHeader(value: Cell) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function text(value: Cell) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function wholeNumber(value: Cell, row: number, label: string) {
  if (value === null || value === undefined || text(value) === '') return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Row ${row}: ${label} must be a whole number of 0 or more`);
  return number;
}

function money(value: Cell, row: number, label: string) {
  if (value === null || value === undefined || text(value) === '') return 0;
  const amount = Number(text(value).replace(/[$£€₵,\s]/g, ''));
  if (!Number.isFinite(amount) || amount < 0 || amount > 21_474_836.47) throw new Error(`Row ${row}: ${label} must be a valid non-negative amount`);
  return Math.round(amount * 100);
}

function optionalMoney(value: Cell, row: number, label: string) {
  if (value === null || value === undefined || text(value) === '') return undefined;
  return money(value, row, label);
}

function parseCsv(source: string): Cell[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}
