import { ArrowLeftRight, Download, FileClock, Package, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, api, type DataExportType } from '../../api';
import { useAuth } from '../../auth-context';
import { PageHeader } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
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
  const { accessToken, signOut } = useAuth();
  const [downloading, setDownloading] = useState<DataExportType | null>(null);

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
