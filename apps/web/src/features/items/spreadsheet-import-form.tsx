import { Download } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { SpreadsheetImportIcon } from '../../components/animated-icons';
import { SelectControl } from '../../components/inventory-ui';
import type { Place } from '../../types';
import { inventoryTemplate, readInventorySpreadsheet, type SpreadsheetItem } from './spreadsheet-import';

type SpreadsheetImportFormProps = {
  locations: readonly Place[];
  busy: boolean;
  onImport: (locationId: string, rows: SpreadsheetItem[]) => Promise<void>;
  onImported?: (count: number) => void;
  formatMoney?: (cents: number) => string;
  submitLabel?: (count: number) => string;
  className?: string;
};

export function SpreadsheetImportForm({
  locations,
  busy,
  onImport,
  onImported,
  formatMoney = plainMoney,
  submitLabel = defaultSubmitLabel,
  className = '',
}: SpreadsheetImportFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<SpreadsheetItem[]>([]);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [reading, setReading] = useState(false);
  const [completeCount, setCompleteCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selectedLocationId = locations.some((location) => location.id === locationId)
    ? locationId
    : locations[0]?.id ?? '';

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    setCompleteCount(0);
    setError(null);
    try {
      setRows(await readInventorySpreadsheet(file));
      setFileName(file.name);
    } catch (caught) {
      setRows([]);
      setFileName('');
      setError(caught instanceof Error ? caught.message : 'Could not read this spreadsheet');
    } finally {
      setReading(false);
      event.target.value = '';
    }
  };

  const submit = async () => {
    if (!rows.length || !selectedLocationId) return;
    setError(null);
    try {
      const count = rows.length;
      await onImport(selectedLocationId, rows);
      setCompleteCount(count);
      setRows([]);
      setFileName('');
      onImported?.(count);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import this spreadsheet');
    }
  };

  const iconState = completeCount ? 'complete' : reading || busy ? 'reading' : 'idle';
  return <div className={`spreadsheet-import-body ${className}`}>
    <button className={`spreadsheet-dropzone ${rows.length ? 'has-file' : ''}`} disabled={reading || busy} onClick={() => inputRef.current?.click()} type="button">
      <SpreadsheetImportIcon size={34} state={iconState} />
      <span>
        <b>{reading ? 'Reading spreadsheet' : completeCount ? `${completeCount} ${completeCount === 1 ? 'item' : 'items'} imported` : fileName || 'Choose an Excel or CSV file'}</b>
        <small>{rows.length ? `${rows.length} valid ${rows.length === 1 ? 'item' : 'items'} ready to import` : completeCount ? 'Your opening inventory is ready' : 'Use .xlsx or .csv, up to 200 items'}</small>
      </span>
    </button>
    <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => void chooseFile(event)} />
    <button className="spreadsheet-template-button" onClick={downloadTemplate} type="button"><Download size={15} />Download column template</button>
    {error && <div className="form-error spreadsheet-import-error" role="alert">{error}</div>}
    {rows.length > 0 && <div className="spreadsheet-preview">
      <div className="spreadsheet-preview-heading"><b>Preview</b><span>First {Math.min(rows.length, 5)} of {rows.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Name</th><th>Category</th><th className="num">Opening</th><th className="num">Cost</th></tr></thead><tbody>{rows.slice(0, 5).map((row) => <tr key={row.sku}><td><b>{row.sku}</b></td><td>{row.name}</td><td>{row.category}</td><td className="num">{row.openingStock}</td><td className="num">{formatMoney(row.unitCostCents)}</td></tr>)}</tbody></table></div>
    </div>}
    {!completeCount && <div className="spreadsheet-import-actions">
      <label><span>Opening place</span><SelectControl aria-label="Opening place for imported stock" disabled={busy} value={selectedLocationId} onValueChange={setLocationId} options={[{ value: '', label: 'Select place' }, ...locations.map((place) => ({ value: place.id, label: place.name }))]} /></label>
      <button className="button" disabled={busy || reading || !rows.length || !selectedLocationId} onClick={() => void submit()} type="button"><SpreadsheetImportIcon state={iconState} />{busy ? 'Importing' : rows.length ? submitLabel(rows.length) : 'Import items'}</button>
    </div>}
  </div>;
}

function downloadTemplate() {
  const content = inventoryTemplate.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'stockledger-inventory-template.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function plainMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function defaultSubmitLabel(count: number) {
  return `Import ${count} ${count === 1 ? 'item' : 'items'}`;
}
