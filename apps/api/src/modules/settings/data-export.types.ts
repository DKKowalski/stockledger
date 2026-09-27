export enum DataExportType {
  INVENTORY = 'inventory',
  MOVEMENTS = 'movements',
  ACTIVITY = 'activity',
  WORKSPACE = 'workspace',
}

export type DataExport = {
  filename: string;
  content: string;
  contentType: string;
};
