import { Component, Suspense, type ReactNode } from 'react';

class PageLoadError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="empty page-state" role="alert"><p>This page could not load. Check your connection and reload to try again.</p><button className="button secondary" onClick={() => window.location.reload()}>Reload page</button></div>;
    return this.props.children;
  }
}
export function FeatureBoundary({ children }: { children: ReactNode }) {
  return <PageLoadError><Suspense fallback={<div className="empty page-state" role="status"><p>Loading page</p></div>}>{children}</Suspense></PageLoadError>;
}
