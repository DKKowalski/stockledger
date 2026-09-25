import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StockLedgerMark } from './stockledger-mark';
import { Sentry } from '../monitoring';

type State = { failed: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="fatal-error-page"><StockLedgerMark size={34} /><h1>StockLedger hit a problem.</h1><p>Your data is safe. Reload the page to continue.</p><button className="button" onClick={() => window.location.reload()} type="button">Reload</button></main>;
  }
}
