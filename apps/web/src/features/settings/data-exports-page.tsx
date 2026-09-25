import { ArrowLeftRight, Download, FileClock, Package, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, api, type DataExportType } from '../../api';
import { useAuth } from '../../auth-context';
import { useCompanySettings } from '../../app/company-settings-store';
import { PageHeader } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { SettingsNavigation } from './settings-navigation';

const exports: Array<{
  type: DataExportType;
  title: string;
  description: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    type: 'inventory',
    title: 'Inventory balances',
    description: 'Current stock position for every item and place.',
    detail: 'Includes opening stock, movement totals, closing stock, reorder levels, costs, prices, and stock value.',
    icon: Package,
  },
  {
    type: 'movements',
    title: 'Movement ledger',
    description: 'The complete history of stock moving in and out.',
    detail: 'Includes movement dates, places, quantities, references, notes, and recorded sale values.',
    icon: ArrowLeftRight,
  },
  {
    type: 'activity',
    title: 'Activity history',
    description: 'Administrative and security events for this business.',
    detail: 'Includes the actor, timestamp, action, affected record, and recorded event details.',
    icon: FileClock,
  },
];

export function DataExportsPage() {
  const { accessToken, user, signOut } = useAuth();
  const { settings } = useCompanySettings();
  const [downloading, setDownloading] = useState<DataExportType | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  const exportFile = async (type: DataExportType) => {
    if (!accessToken || downloading) return;
    setDownloading(type);
    try {
      const file = await api.exportData(accessToken, type);
      saveFile(file.blob, file.filename);
      toast.success('CSV export ready', { description: `${file.filename} has been downloaded.` });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else toast.error('Could not export data', { description: caught instanceof Error ? caught.message : 'Try again in a moment.' });
    } finally {
      setDownloading(null);
    }
  };

  const deleteWorkspace = async () => {
    if (!accessToken || !settings || deleting || user?.isDemo) return;
    setDeleting(true);
    setDeletionError(null);
    try {
      await api.deleteWorkspace(accessToken, { currentPassword: password, confirmation });
      toast.success('Workspace deleted');
      signOut();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setDeletionError(caught instanceof Error ? caught.message : 'Could not delete this workspace');
    } finally {
      setDeleting(false);
    }
  };

  return <>
    <PageHeader title="Data exports" subtitle="Download a portable copy of your business records." />
    <SettingsNavigation />
    <div className="data-export-grid">
      {exports.map(({ type, title, description, detail, icon: Icon }) => <article className="panel data-export-card" key={type}>
        <div className="data-export-card-top">
          <span className="data-export-icon"><Icon size={20} /></span>
          <span className="csv-badge">CSV</span>
        </div>
        <h2>{title}</h2>
        <p>{description}</p>
        <small>{detail}</small>
        <button className="button secondary data-export-button" disabled={downloading !== null} onClick={() => void exportFile(type)} type="button">
          {downloading === type ? <><StockLedgerMark animated size={19} />Preparing file</> : <><Download size={16} />Download CSV</>}
        </button>
      </article>)}
    </div>
    <div className="export-security-note">
      <ShieldCheck size={18} />
      <div><h2>Administrator access only</h2><p>Each file contains records from this business only. StockLedger records the export in your activity history.</p></div>
    </div>
    <section className="panel workspace-danger-zone">
      <div className="workspace-danger-copy"><span><Trash2 size={18} /></span><div><h2>Delete workspace</h2><p>Permanently remove this business, its team, inventory, movements, and activity history.</p></div></div>
      {!deletionOpen ? <button className="button danger-button" disabled={user?.isDemo} onClick={() => setDeletionOpen(true)} type="button">Delete workspace</button> : <div className="workspace-delete-form">
        {deletionError && <div className="form-error" role="alert">{deletionError}</div>}
        <p>Download anything you need first. This cannot be undone.</p>
        <label><span>Type <strong>{settings?.name}</strong></span><InputControl autoComplete="off" value={confirmation} onValueChange={setConfirmation} /></label>
        <label><span>Current password</span><InputControl autoComplete="current-password" type="password" value={password} onValueChange={setPassword} /></label>
        <div className="workspace-delete-actions"><button className="button secondary" onClick={() => { setDeletionOpen(false); setConfirmation(''); setPassword(''); setDeletionError(null); }} type="button">Cancel</button><button className="button danger-button" disabled={deleting || !password || confirmation !== settings?.name} onClick={() => void deleteWorkspace()} type="button">{deleting ? 'Deleting workspace' : 'Delete permanently'}</button></div>
      </div>}
    </section>
  </>;
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
