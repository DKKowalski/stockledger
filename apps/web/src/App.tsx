import { Navigate, Route, Routes } from 'react-router-dom';
import { InventoryProvider } from './app/inventory-store';
import { RoleWorkspace } from './app/role-workspace';
import { useAuth } from './auth-context';
import { StockLedgerMark } from './components/stockledger-mark';
import { LoginPage } from './features/auth/login-page';

export function App() {
  const { accessToken, restoring, user } = useAuth();

  if (restoring || (accessToken && !user)) return <AppLoader />;

  if (!accessToken) {
    return <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>;
  }

  return <InventoryProvider><RoleWorkspace /></InventoryProvider>;
}

function AppLoader() {
  return <div className="app-loader" role="status">
    <span className="brand-mark"><StockLedgerMark animated size={48} /></span>
    <span className="sr-only">Restoring session</span>
  </div>;
}
