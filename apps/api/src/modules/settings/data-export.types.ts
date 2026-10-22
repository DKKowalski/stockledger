export enum DataExportType {
  INVENTORY = 'inventory',
  MOVEMENTS = 'movements',
  ACTIVITY = 'activity',
  WORKSPACE = 'workspace',
  WORKSPACE_V2 = 'workspace-v2',
  WORKSPACE_V3 = 'workspace-v3',
  WORKSPACE_V4 = 'workspace-v4',
  WORKSPACE_V5 = 'workspace-v5',
}

export type DataExport = {
  filename: string;
  content: string;
  contentType: string;
};
