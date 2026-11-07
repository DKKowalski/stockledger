import { useLocation } from 'react-router-dom';
import { Component, Suspense, type ReactNode } from 'react';

type PageLoadProps = { children: ReactNode; routeKey: string };
class PageLoadError extends Component<PageLoadProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: PageLoadProps) {
    // Reset a failed page without remounting healthy workspace providers on navigation.
    if (this.state.failed && previous.routeKey !== this.props.routeKey) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <div className="empty page-state" role="alert"><p>This page could not load. Check your connection and reload to try again.</p><button className="button secondary" onClick={() => window.location.reload()}>Reload page</button></div>;
    return this.props.children;
  }
}
export function FeatureBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <PageLoadError routeKey={pathname}><Suspense fallback={<div className="empty page-state" role="status"><p>Loading page</p></div>}>{children}</Suspense></PageLoadError>;
}
