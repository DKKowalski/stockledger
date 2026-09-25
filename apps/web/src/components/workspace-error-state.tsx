import type { UserFacingError } from '../lib/user-facing-error';
import { StockLedgerMark } from './stockledger-mark';

export function WorkspaceErrorState({ error, onRetry, onSignOut }: { error: UserFacingError; onRetry: () => void; onSignOut: () => void }) {
  return <main className="gate-error" role="alert">
    <div className="gate-error-content">
      <StockLedgerMark className="gate-error-mark" size={40} />
      <h1>{error.title}</h1>
      <p>{error.description}</p>
      <div className="gate-error-actions"><button className="button" onClick={onRetry} type="button">Try again</button><button className="gate-error-signout" onClick={onSignOut} type="button">Sign out</button></div>
    </div>
  </main>;
}
