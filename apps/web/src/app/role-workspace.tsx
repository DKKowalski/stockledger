const OwnerSalesPage = lazy(() => import('../features/sales/owner-sales-page').then(m => ({ default: m.OwnerSalesPage })));
import { lazy } from 'react';
import { FeatureBoundary } from '../components/feature-boundary';
const FinancePage = lazy(() => import('../features/finance/finance-page').then(m => ({ default: m.FinancePage })));
import { ArrowLeftRight, ChartColumn, CircleDollarSign, Landmark, LayoutDashboard, MapPin, Package, ShoppingBag, Users } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth-context';
const AccountSettingsPage = lazy(() => import('../features/account/account-settings-page').then(m => ({ default: m.AccountSettingsPage })));
const BusinessSettingsPage = lazy(() => import('../features/settings/business-settings-page').then(m => ({ default: m.BusinessSettingsPage })));
const ActivityLogPage = lazy(() => import('../features/settings/activity-log-page').then(m => ({ default: m.ActivityLogPage })));
const DataExportsPage = lazy(() => import('../features/settings/data-exports-page').then(m => ({ default: m.DataExportsPage })));
const InventorySettingsPage = lazy(() => import('../features/settings/inventory-settings-page').then(m => ({ default: m.InventorySettingsPage })));
const SecuritySettingsPage = lazy(() => import('../features/settings/security-settings-page').then(m => ({ default: m.SecuritySettingsPage })));
const TerminologySettingsPage = lazy(() => import('../features/settings/terminology-settings-page').then(m => ({ default: m.TerminologySettingsPage })));
const PlacesPage = lazy(() => import('../features/admin/places-page').then(m => ({ default: m.PlacesPage })));
const TeamPage = lazy(() => import('../features/admin/team-page').then(m => ({ default: m.TeamPage })));
const OperationsDashboardPage = lazy(() => import('../features/dashboard/dashboard-pages').then(m => ({ default: m.OperationsDashboardPage })));
const ShopDashboardPage = lazy(() => import('../features/dashboard/dashboard-pages').then(m => ({ default: m.ShopDashboardPage })));
const ManagerItemsPage = lazy(() => import('../features/items/item-pages').then(m => ({ default: m.ManagerItemsPage })));
const ShopCatalogPage = lazy(() => import('../features/items/item-pages').then(m => ({ default: m.ShopCatalogPage })));
const AdminItemsPage = lazy(() => import('../features/items/admin-items-page').then(m => ({ default: m.AdminItemsPage })));
const MovementsPage = lazy(() => import('../features/movements/movements-page').then(m => ({ default: m.MovementsPage })));
const OperationsReportsPage = lazy(() => import('../features/reports/report-pages').then(m => ({ default: m.OperationsReportsPage })));
const ShopReportsPage = lazy(() => import('../features/reports/report-pages').then(m => ({ default: m.ShopReportsPage })));
const ShopSalesPage = lazy(() => import('../features/sales/shop-sales-page').then(m => ({ default: m.ShopSalesPage })));
const ProfitabilityPage = lazy(() => import('../features/profitability/profitability-page').then(m => ({ default: m.ProfitabilityPage })));
const StockCountsPage = lazy(() => import('../features/stock-counts/stock-counts-page').then(m => ({ default: m.StockCountsPage })));
const SuppliersPage = lazy(() => import('../features/suppliers/suppliers-page').then(m => ({ default: m.SuppliersPage })));
import { AppShell, type NavigationItem } from '../components/app-shell';

const administratorNavigation = [
  ['/', 'Overview', LayoutDashboard, 'overview'],
  ['/sell', 'Sell', ShoppingBag, 'sell'],
  ['/items', 'Items', Package, 'items'],
  ['/movements', 'Movements', ArrowLeftRight, 'movement'],
  ['/reports', 'Reports', ChartColumn, 'reports'],
  ['/profitability', 'Profit', CircleDollarSign, 'reports'],
  ['/finance', 'Finance', Landmark, 'reports'],
  ['/places', 'Places', MapPin, 'places'],
  ['/team', 'Team', Users, 'team'],
] as const satisfies readonly NavigationItem[];

const managerNavigation = [
  ['/', 'Overview', LayoutDashboard, 'overview'],
  ['/items', 'Items', Package, 'items'],
  ['/movements', 'Movements', ArrowLeftRight, 'movement'],
  ['/reports', 'Reports', ChartColumn, 'reports'],
] as const satisfies readonly NavigationItem[];

const attendantNavigation = [
  ['/', 'Overview', LayoutDashboard, 'overview'],
  ['/sell', 'Sell', ShoppingBag, 'sell'],
  ['/items', 'Catalog', Package, 'items'],
  ['/reports', 'Reports', ChartColumn, 'reports'],
] as const satisfies readonly NavigationItem[];

export function RoleWorkspace() {
  const { user } = useAuth();
  if (!user) return null;

  switch (user.role) {
    case 'administrator':
      return <AdministratorWorkspace />;
    case 'inventory_manager':
      return <ManagerWorkspace />;
    case 'shop_attendant':
      return <ShopWorkspace />;
  }
}

function AdministratorWorkspace() {
  return <Routes><Route element={<AppShell navigation={administratorNavigation} />}>
    <Route path="sell" element={<FeatureBoundary><OwnerSalesPage /></FeatureBoundary>} />
    <Route index element={<FeatureBoundary><OperationsDashboardPage /></FeatureBoundary>} />
    <Route path="items" element={<FeatureBoundary><AdminItemsPage /></FeatureBoundary>} />
    <Route path="movements" element={<FeatureBoundary><MovementsPage /></FeatureBoundary>} />
    <Route path="reports" element={<FeatureBoundary><OperationsReportsPage /></FeatureBoundary>} />
    <Route path="profitability" element={<FeatureBoundary><ProfitabilityPage /></FeatureBoundary>} />
    <Route path="finance" element={<FeatureBoundary><FinancePage /></FeatureBoundary>} />
    <Route path="stock-counts" element={<FeatureBoundary><StockCountsPage /></FeatureBoundary>} />
    <Route path="suppliers" element={<FeatureBoundary><SuppliersPage /></FeatureBoundary>} />
    <Route path="places" element={<FeatureBoundary><PlacesPage /></FeatureBoundary>} />
    <Route path="team" element={<FeatureBoundary><TeamPage /></FeatureBoundary>} />
    <Route path="account" element={<FeatureBoundary><AccountSettingsPage /></FeatureBoundary>} />
    <Route path="settings" element={<FeatureBoundary><BusinessSettingsPage /></FeatureBoundary>} />
    <Route path="settings/inventory" element={<FeatureBoundary><InventorySettingsPage /></FeatureBoundary>} />
    <Route path="settings/security" element={<FeatureBoundary><SecuritySettingsPage /></FeatureBoundary>} />
    <Route path="settings/terminology" element={<FeatureBoundary><TerminologySettingsPage /></FeatureBoundary>} />
    <Route path="settings/activity" element={<FeatureBoundary><ActivityLogPage /></FeatureBoundary>} />
    <Route path="settings/data" element={<FeatureBoundary><DataExportsPage /></FeatureBoundary>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function ManagerWorkspace() {
  return <Routes><Route element={<AppShell navigation={managerNavigation} />}>
    <Route index element={<FeatureBoundary><OperationsDashboardPage /></FeatureBoundary>} />
    <Route path="items" element={<FeatureBoundary><ManagerItemsPage /></FeatureBoundary>} />
    <Route path="movements" element={<FeatureBoundary><MovementsPage /></FeatureBoundary>} />
    <Route path="reports" element={<FeatureBoundary><OperationsReportsPage /></FeatureBoundary>} />
    <Route path="stock-counts" element={<FeatureBoundary><StockCountsPage /></FeatureBoundary>} />
    <Route path="suppliers" element={<FeatureBoundary><SuppliersPage /></FeatureBoundary>} />
    <Route path="account" element={<FeatureBoundary><AccountSettingsPage /></FeatureBoundary>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function ShopWorkspace() {
  return <Routes><Route element={<AppShell navigation={attendantNavigation} />}>
    <Route index element={<FeatureBoundary><ShopDashboardPage /></FeatureBoundary>} />
    <Route path="sell" element={<FeatureBoundary><ShopSalesPage /></FeatureBoundary>} />
    <Route path="items" element={<FeatureBoundary><ShopCatalogPage /></FeatureBoundary>} />
    <Route path="reports" element={<FeatureBoundary><ShopReportsPage /></FeatureBoundary>} />
    <Route path="account" element={<FeatureBoundary><AccountSettingsPage /></FeatureBoundary>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}
