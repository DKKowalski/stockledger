import { Check } from 'lucide-react';
import { StockLedgerMark } from '../../components/stockledger-mark';

// Appears only while there is something to save, so it never covers settings for nothing.
export function SettingsSaveBar({ changed, saving, onDiscard }: { changed: boolean; saving: boolean; onDiscard: () => void }) {
  if (!changed && !saving) return null;
  return <div className="settings-save-bar" role="region" aria-label="Unsaved changes">
    <span>You have unsaved changes.</span>
    <div className="settings-save-actions">
      <button className="button secondary" disabled={saving} onClick={onDiscard} type="button">Discard</button>
      <button className="button" disabled={saving} type="submit">{saving ? <><StockLedgerMark animated size={20} />Saving</> : <>Save changes<Check size={16} /></>}</button>
    </div>
  </div>;
}
