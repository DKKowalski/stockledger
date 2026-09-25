export enum DataExportType {
  INVENTORY = 'inventory',
  MOVEMENTS = 'movements',
  ACTIVITY = 'activity',
}

export type DataExport = {
  filename: string;
  csv: string;
};
