import { LogOut, Unplug } from 'lucide-react';
import type { UserFacingError } from '../lib/user-facing-error';
import { StockLedgerMark } from './stockledger-mark';

export function WorkspaceErrorState({ error, onRetry, onSignOut }: { error: UserFacingError; onRetry: () => void; onSignOut: () => void }) {
  return <main className="gate-error" role="alert">
    <div className="gate-error-content">
      <span className="gate-error-mark"><StockLedgerMark size={33} /></span>
      <span className="gate-error-label"><Unplug size={14} />{error.label}</span>
      <h1>{error.title}</h1>
      <p>{error.description}</p>
      <div className="gate-error-actions"><button className="button" onClick={onRetry} type="button">Try again</button><button className="button secondary" onClick={onSignOut} type="button"><LogOut size={15} />Sign out</button></div>
      {error.requestId && <small className="gate-error-reference">If this keeps happening, send support reference <code>{error.requestId}</code>.</small>}
    </div>
  </main>;
}
