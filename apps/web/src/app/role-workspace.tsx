import { ArrowLeftRight, ChartColumn, LayoutDashboard, MapPin, Package, ShoppingBag, Users } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { PlacesPage } from '../features/admin/places-page';
import { TeamPage } from '../features/admin/team-page';
import { OperationsDashboardPage, ShopDashboardPage } from '../features/dashboard/dashboard-pages';
import { AdminItemsPage, ManagerItemsPage, ShopCatalogPage } from '../features/items/item-pages';
import { MovementsPage } from '../features/movements/movements-page';
import { OperationsReportsPage, ShopReportsPage } from '../features/reports/report-pages';
import { ShopSalesPage } from '../features/sales/shop-sales-page';
import { AppShell, type NavigationItem } from '../components/app-shell';

const administratorNavigation = [
  ['/', 'Overview', LayoutDashboard, 'overview'],
  ['/items', 'Items', Package, 'items'],
  ['/movements', 'Movements', ArrowLeftRight, 'movement'],
  ['/reports', 'Reports', ChartColumn, 'reports'],
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
    <Route index element={<OperationsDashboardPage />} />
    <Route path="items" element={<AdminItemsPage />} />
    <Route path="movements" element={<MovementsPage />} />
    <Route path="reports" element={<OperationsReportsPage />} />
    <Route path="places" element={<PlacesPage />} />
    <Route path="team" element={<TeamPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function ManagerWorkspace() {
  return <Routes><Route element={<AppShell navigation={managerNavigation} />}>
    <Route index element={<OperationsDashboardPage />} />
    <Route path="items" element={<ManagerItemsPage />} />
    <Route path="movements" element={<MovementsPage />} />
    <Route path="reports" element={<OperationsReportsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}

function ShopWorkspace() {
  return <Routes><Route element={<AppShell navigation={attendantNavigation} />}>
    <Route index element={<ShopDashboardPage />} />
    <Route path="sell" element={<ShopSalesPage />} />
    <Route path="items" element={<ShopCatalogPage />} />
    <Route path="reports" element={<ShopReportsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}
