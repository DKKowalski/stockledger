import {
  ArrowLeftRight,
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  ShoppingBag,
  PackageOpen,
  PackageX,
  RefreshCw,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { ApiError, api } from './api';
import { useAuth } from './auth-context';
import { StockLedgerMark } from './components/stockledger-mark';
import type { LocationType, MovementType, Place, Position, Snapshot, User, UserRole } from './types';

const roleLabel: Record<UserRole, string> = {
  administrator: 'Administrator',
  inventory_manager: 'Inventory manager',
  shop_attendant: 'Shop attendant',
};

const placeLabel: Record<LocationType, string> = {
  warehouse: 'Warehouse',
  shop: 'Shop',
};

const movementMeta: Record<MovementType, { label: string; hint: string }> = {
  purchase: { label: 'Purchase', hint: 'Goods received into a place' },
  transfer: { label: 'Transfer', hint: 'Move stock from one place to another' },
  return_in: { label: 'Return in', hint: 'Goods returned into a place' },
  return_out: { label: 'Return to supplier', hint: 'Goods sent back to the supplier' },
  damage: { label: 'Damaged stock', hint: 'Stock written off as damaged' },
  sale: { label: 'Sale', hint: 'Goods sold at a shop' },
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${date}T00:00:00`));

type Store = {
  snapshot: Snapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  days: number;
  setDays: (days: number) => void;
  locationId: string | null;
  setLocationId: (locationId: string | null) => void;
  refresh: () => Promise<void>;
  notice: { id: number; title: string; message: string; visible: boolean } | null;
  dismissNotice: () => void;
  notify: (message: string, title?: string) => void;
  mutate: (action: () => Promise<unknown>, successMessage: string) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

const useStore = () => {
  const store = useContext(StoreContext);
  if (!store) throw new Error('Missing inventory store');
  return store;
};

export function App() {
  const { accessToken, restoring } = useAuth();

  if (restoring) return <AppLoader />;

  return (
    <Routes>
      <Route path="/login" element={accessToken ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={accessToken ? <InventoryProvider><Shell /></InventoryProvider> : <Navigate to="/login" replace />}
      >
        <Route index element={<Dashboard />} />
        <Route path="sell" element={<Sell />} />
        <Route path="items" element={<Items />} />
        <Route path="movements" element={<Movements />} />
        <Route path="reports" element={<Reports />} />
        <Route path="places" element={<Places />} />
        <Route path="team" element={<Team />} />
      </Route>
      <Route path="*" element={<Navigate to={accessToken ? '/' : '/login'} replace />} />
    </Routes>
  );
}

function AppLoader() {
  return (
    <div className="app-loader" role="status">
      <span className="brand-mark"><StockLedgerMark animated size={48} /></span>
      <span className="sr-only">Restoring session</span>
    </div>
  );
}

function InventoryProvider({ children }: { children: ReactNode }) {
  const { accessToken, user, signOut } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [locationId, setLocationId] = useState<string | null>(user?.role === 'shop_attendant' ? user.locationId : null);
  const [notice, setNotice] = useState<{ id: number; title: string; message: string; visible: boolean } | null>(null);
  const noticeId = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  if (!accessToken) throw new Error('InventoryProvider requires an authenticated session');

  const handleError = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof ApiError && caught.status === 401) signOut();
    setError(caught instanceof Error ? caught.message : fallback);
  }, [signOut]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await api.snapshot(accessToken, days, locationId));
    } catch (caught) {
      handleError(caught, 'Could not load inventory');
    } finally {
      setLoading(false);
    }
  }, [accessToken, days, locationId, handleError]);

  useEffect(() => {
    let cancelled = false;

    void api.snapshot(accessToken, days, locationId)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) handleError(caught, 'Could not load inventory');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [accessToken, days, locationId, handleError]);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice((current) => current ? { ...current, visible: false } : null);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 180);
  }, []);

  const notify = useCallback((message: string, title = 'Inventory updated') => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    const id = ++noticeId.current;
    setNotice({ id, title, message, visible: true });
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) => current?.id === id ? { ...current, visible: false } : current);
      noticeTimer.current = window.setTimeout(() => {
        setNotice((current) => current?.id === id ? null : current);
      }, 180);
    }, 3200);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  const mutate = useCallback(async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSnapshot(await api.snapshot(accessToken, days, locationId));
      notify(successMessage);
    } catch (caught) {
      handleError(caught, 'Request failed');
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [accessToken, days, locationId, handleError, notify]);

  const store = useMemo(
    () => ({ snapshot, loading, busy, error, days, setDays, locationId, setLocationId, refresh, notice, dismissNotice, notify, mutate }),
    [snapshot, loading, busy, error, days, locationId, refresh, notice, dismissNotice, notify, mutate],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = () => {
    setEmail('admin@stockledger.app');
    setPassword('StockLedger123!');
    setError(null);
  };

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="StockLedger product overview">
        <div className="login-image">
          <img alt="" aria-hidden="true" src="/images/login-warehouse.jpg" />
          <div className="login-brand"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</div>
          <div className="login-visual-copy">
            <h1>Every item accounted for.</h1>
            <p>Know what came in, what went out, and what remains.</p>
          </div>
        </div>
      </section>

      <section className="login-form-pane">
        <div className="mobile-login-brand"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</div>
        <div className="login-form-wrap">
          <div className="login-heading">
            <h2>Welcome back</h2>
            <p>Sign in to open your inventory workspace.</p>
          </div>

          <form className="login-form" onSubmit={(event) => void submit(event)}>
            {error && <div className="login-error" role="alert">{error}</div>}
            <label>
              <span>Email address</span>
              <input autoComplete="email" inputMode="email" placeholder="you@company.com" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <span className="password-field">
                <input autoComplete="current-password" placeholder="Enter your password" required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <button className="button login-submit" disabled={submitting}>
              {submitting ? <><StockLedgerMark animated size={20} />Signing in</> : <>Sign in<ArrowUpRight size={17} /></>}
            </button>
          </form>

          <button className="demo-login" type="button" onClick={useDemo}>
            <span><b>Preview the demo workspace</b><small>Fill in the seeded administrator account</small></span>
            <ChevronRight size={18} />
          </button>
        </div>
        <p className="login-footnote">Protected with encrypted passwords and expiring sessions.</p>
      </section>
    </main>
  );
}

function Shell() {
  const { error, refresh, notice, dismissNotice } = useStore();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const links: Array<readonly [string, string, LucideIcon]> = [
    ['/', 'Overview', LayoutDashboard],
  ];
  if (user?.role === 'shop_attendant') links.push(['/sell', 'Sell', ShoppingBag]);
  links.push(['/items', 'Items', Package]);
  if (user?.role !== 'shop_attendant') links.push(['/movements', 'Stock movements', ArrowLeftRight]);
  links.push(['/reports', 'Reports', ChartColumn]);
  if (user?.role === 'administrator') {
    links.push(['/places', 'Places', MapPin], ['/team', 'Team', Users]);
  }
  const initials = user?.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('') ?? 'SL';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-mark"><StockLedgerMark /></span>StockLedger</NavLink>
          <nav id="primary-navigation" className={`top-nav ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
            <button className="mobile-signout" onClick={signOut}><LogOut size={18} /><span>Sign out</span></button>
          </nav>
          <div className="navbar-account">
            <div className="topbar-user">
              <span className="avatar">{initials}</span>
              <span className="topbar-user-copy"><b>{user?.fullName}</b><small>{user ? roleLabel[user.role] : ''}</small></span>
            </div>
            <button className="signout-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={17} /></button>
          </div>
          <button className="menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>
      <button className={`nav-scrim ${menuOpen ? 'open' : ''}`} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />

      <div className="shell-content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}
        <main className="page"><Outlet /></main>
        {notice && <div className={`toast ${notice.visible ? 'visible' : ''}`} role="status" aria-live="polite">
          <span className="toast-icon"><Check size={16} /></span>
          <div><b>{notice.title}</b><span>{notice.message}</span></div>
          <button aria-label="Dismiss notification" onClick={dismissNotice}><X size={16} /></button>
        </div>}
      </div>
    </div>
  );
}

function Header({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="actions">{actions}</div>}</div>;
}

function State({ children }: { children: ReactNode }) {
  const { loading, snapshot } = useStore();
  if (loading && !snapshot) return <div className="empty page-state"><StockLedgerMark animated size={40} /><p>Loading inventory</p></div>;
  return children;
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><PackageOpen /><p>{text}</p></div>;
}

function Kpi({ icon: Icon, label, value, note, tone = '' }: { icon: LucideIcon; label: string; value: string; note: string; tone?: string }) {
  return (
    <article className="panel kpi">
      <div className="kpi-top"><p>{label}</p><span className={`kpi-icon ${tone}`}><Icon size={19} /></span></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function PlaceFilter() {
  const { snapshot, locationId, setLocationId } = useStore();
  const { user } = useAuth();
  if (!snapshot) return null;
  const locked = user?.role === 'shop_attendant';
  return (
    <SelectControl aria-label="Place" value={locationId ?? ''} disabled={locked} onChange={(event) => setLocationId(event.target.value || null)}>
      {!locked && <option value="">All places</option>}
      {snapshot.locations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
    </SelectControl>
  );
}

function Dashboard() {
  const { snapshot, refresh, loading } = useStore();
  const { user } = useAuth();
  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  const placeName = snapshot?.locationId ? snapshot.locations.find((place) => place.id === snapshot.locationId)?.name : null;

  return <State>{snapshot && <>
    <Header title={`Welcome back, ${firstName}`} subtitle={placeName ? `Stock held at ${placeName}.` : 'Stock held across every place in the company.'} actions={<><PlaceFilter /><button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} />Refresh</button>{user?.role === 'shop_attendant' ? <NavLink className="button" to="/sell">Sell<ArrowUpRight size={16} /></NavLink> : <NavLink className="button" to="/movements">Record movement<ArrowUpRight size={16} /></NavLink>}</>} />
    <section className="kpi-grid">
      <Kpi icon={Warehouse} label="Closing stock" value={snapshot.summary.closingUnits.toLocaleString()} note={`${money(snapshot.summary.stockValueCents)} at cost`} />
      <Kpi icon={TriangleAlert} label="Low stock items" value={String(snapshot.summary.lowStockItems)} note="At or below reorder level" tone="warning" />
      <Kpi icon={PackageX} label="Damaged units" value={snapshot.summary.damagedUnits.toLocaleString()} note="Written off to date" tone="danger" />
      <Kpi icon={TrendingUp} label="Dead stock lines" value={String(snapshot.summary.deadStockLines)} note={`No sale or transfer out in ${snapshot.periodDays} days`} tone="success" />
    </section>
    <section className="insights-grid">
      <StockLevels positions={snapshot.positions} />
      <StockHealth positions={snapshot.positions} />
    </section>
    <section className="dashboard-grid">
      <Panel title="Recent movements" subtitle="Latest stock activity" className="movement-panel">
        {snapshot.movements.length ? <div className="movement-list">{snapshot.movements.slice(0, 6).map((movement) => (
          <div className="movement-row" key={movement.id}>
            <span className={`movement-icon ${movement.sign === 1 ? 'in' : 'out'}`}><ArrowLeftRight size={15} /></span>
            <div><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movementMeta[movement.type].label} · {formatDate(movement.movementDate)}</small></div>
            <strong className={movement.sign === 1 ? 'positive' : 'negative'}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</strong>
          </div>
        ))}</div> : <Empty text="No movements recorded yet." />}
      </Panel>
      <Panel title="Attention needed" subtitle="Items at or below reorder level"><LowStock positions={snapshot.positions} /></Panel>
    </section>
  </>}</State>;
}

function StockLevels({ positions }: { positions: Position[] }) {
  const rows = [...positions].sort((a, b) => b.closing - a.closing).slice(0, 5);
  const series = rows.map((position) => ({
    position,
    values: [
      { key: 'opening', label: 'Opening', value: position.opening },
      { key: 'in', label: 'Stock in', value: position.purchases + position.returnsIn + position.transferredIn },
      { key: 'out', label: 'Stock out', value: position.transferredOut + position.returnsOut + position.damaged + position.sales },
      { key: 'closing', label: 'Closing', value: position.closing },
    ],
  }));
  const max = Math.max(...series.flatMap(({ values }) => values.map(({ value }) => value)), 1);

  return (
    <Panel title="Stock movement" subtitle="Opening, inbound, outbound, and closing units" className="stock-chart-panel">
      {rows.length ? <div className="stock-chart">
        <div className="chart-toolbar">
          <div className="chart-legend" aria-label="Chart legend">
            <span><i className="opening" />Opening</span>
            <span><i className="in" />In</span>
            <span><i className="out" />Out</span>
            <span><i className="closing" />Closing</span>
          </div>
          <span className="chart-period"><CalendarDays size={14} />Top 5 items</span>
        </div>
        <div className="chart-grid-lines"><i /><i /><i /><i /></div>
        <div className="chart-bars">{series.map(({ position, values }) => (
          <div className="chart-group" key={`${position.location.id}-${position.item.id}`} title={`${position.item.name} · ${position.location.name}`}>
            <div className="chart-group-bars">
              {values.map(({ key, label, value }) => (
                <span className={`chart-bar ${key}`} key={key} title={`${label}: ${value}`} style={{ height: `${Math.max((value / max) * 100, 4)}%` }}>
                  {key === 'closing' && <b>{value}</b>}
                </span>
              ))}
            </div>
            <small>{position.item.sku.replace('SKU-', '')}</small>
          </div>
        ))}</div>
      </div> : <Empty text="Add items to see stock levels." />}
    </Panel>
  );
}

function StockHealth({ positions }: { positions: Position[] }) {
  const total = positions.length;
  const low = positions.filter((position) => position.isLowStock).length;
  const healthy = Math.max(total - low, 0);
  const healthPercent = total ? Math.round((healthy / total) * 100) : 0;
  const lowPercent = total ? 100 - healthPercent : 0;

  return (
    <Panel title="Inventory health" subtitle="Availability across all item lines" className="health-panel">
      <div className="health-body">
        <div className="health-metric"><strong>{healthPercent}%</strong><span>availability</span><small><ArrowUpDown size={12} />{total} tracked lines</small></div>
        <div className="health-chart-row">
          <div className="health-gauge" role="img" aria-label={`${healthPercent}% of inventory lines are healthy`}>
            <svg viewBox="0 0 240 126" aria-hidden="true">
              <path className="gauge-track" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" />
              <path className="gauge-healthy" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" strokeDasharray={`${healthPercent} ${100 - healthPercent}`} />
              {lowPercent > 0 && <path className="gauge-low" d="M 16 116 A 104 104 0 0 1 224 116" pathLength="100" strokeDasharray={`${lowPercent} ${100 - lowPercent}`} strokeDashoffset={-healthPercent} />}
            </svg>
            <span>Stock health</span>
          </div>
          <div className="health-legend">
            <div><span className="legend-dot healthy" /><p><b>In good standing</b><small>{healthy} item lines</small></p></div>
            <div><span className="legend-dot low" /><p><b>Low stock</b><small>{low} item lines</small></p></div>
          </div>
        </div>
      </div>
      <NavLink className="panel-link" to="/reports">View stock report <ChevronRight size={15} /></NavLink>
    </Panel>
  );
}

function LowStock({ positions }: { positions: Position[] }) {
  const rows = positions.filter((position) => position.isLowStock).slice(0, 5);
  if (!rows.length) return <div className="all-clear"><span><Check size={17} /></span><div><b>All levels look good</b><small>No items need reordering.</small></div></div>;

  return <div className="low-stock-list">{rows.map((position) => {
    const percent = Math.min((position.closing / Math.max(position.item.reorderLevel, 1)) * 100, 100);
    return <div className="low-stock-row" key={`${position.location.id}-${position.item.id}`}>
      <div><b>{position.item.name}</b><small>{position.location.name} · {position.closing} of {position.item.reorderLevel} {position.item.unit}</small></div>
      <span className="stock-progress"><i style={{ width: `${percent}%` }} /></span>
    </div>;
  })}</div>;
}

function Panel({ title, subtitle, className = '', children }: { title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`}><div className="panel-header"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children}</section>;
}

function SelectControl({ children, ...props }: ComponentProps<'select'>) {
  return <span className="select-control"><select {...props}>{children}</select><ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} /></span>;
}

function StockTable({ positions, compact = false }: { positions: Position[]; compact?: boolean }) {
  const showPlace = new Set(positions.map((position) => position.location.id)).size > 1;
  return <div className="table-wrap"><table><thead><tr><th>Item</th>{showPlace && <th>Place</th>}<th className="num">Opening</th>{!compact && <><th className="num">Purchases</th><th className="num">Returns in</th></>}<th className="num">In</th><th className="num">Out</th><th className="num">Closing</th>{!compact && <th className="num">Value</th>}</tr></thead><tbody>{positions.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td>{showPlace && <td>{position.location.name}</td>}<td className="num">{position.opening}</td>{!compact && <><td className="num">{position.purchases}</td><td className="num">{position.returnsIn}</td></>}<td className="num positive">+{position.purchases + position.returnsIn + position.transferredIn}</td><td className="num negative">−{position.transferredOut + position.returnsOut + position.damaged + position.sales}</td><td className="num"><b>{position.closing}</b>{position.isLowStock && <span className="badge">low</span>}</td>{!compact && <td className="num">{money(position.valueCents)}</td>}</tr>)}</tbody></table></div>;
}

function Items() {
  const { accessToken, user } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', sellingPrice: '', openingStock: '0', locationId: '' });
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addItem(accessToken, { sku: form.sku, name: form.name, category: form.category || 'General', unit: form.unit || 'pcs', reorderLevel: Number(form.reorderLevel), unitCostCents: Math.round(Number(form.unitCost) * 100), ...(form.sellingPrice !== '' ? { sellingPriceCents: Math.round(Number(form.sellingPrice) * 100) } : {}), openingStock: Number(form.openingStock), locationId: form.locationId }), `${form.name} was added to inventory.`);
    setForm({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', sellingPrice: '', openingStock: '0', locationId: '' });
  };
  const canAdd = user?.role === 'administrator';
  return <State><Header title="Items" subtitle="The company catalog. Opening stock is recorded at one place." />
    {canAdd && <Panel title="Add item" subtitle="Opening stock lands at the place you choose"><form className="form-grid item-form" onSubmit={(event) => void submit(event).catch(() => {})}>{(['sku', 'name', 'category', 'unit'] as const).map((key) => <label key={key}><span>{key === 'sku' ? 'SKU' : key[0].toUpperCase() + key.slice(1)}</span><input required={key === 'sku' || key === 'name'} value={form[key]} onChange={(event) => change(key, event.target.value)} /></label>)}<label><span>Reorder level</span><input type="number" min="0" required value={form.reorderLevel} onChange={(event) => change('reorderLevel', event.target.value)} /></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" required value={form.unitCost} onChange={(event) => change('unitCost', event.target.value)} /></label><label><span>Selling price (optional)</span><input type="number" min="0" max="21474836.47" step="0.01" placeholder="Not set" value={form.sellingPrice} onChange={(event) => change('sellingPrice', event.target.value)} /></label><label><span>Opening place</span><SelectControl required value={form.locationId} onChange={(event) => change('locationId', event.target.value)}><option value="">Select place</option>{snapshot?.locations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</SelectControl></label><label><span>Opening stock</span><input type="number" min="0" required value={form.openingStock} onChange={(event) => change('openingStock', event.target.value)} /></label><button className="button" disabled={busy || !snapshot?.locations.length}>Add item<ArrowUpRight size={16} /></button></form></Panel>}
    {canAdd && <SellingPrices />}
    <Panel title={`Stock by place (${snapshot?.positions.length ?? 0})`} className={canAdd ? 'spaced' : ''}>{snapshot?.positions.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th>Category</th><th>Unit</th><th className="num">Reorder</th><th className="num">Cost</th><th className="num">Selling price</th><th className="num">Closing</th><th className="num">Value</th></tr></thead><tbody>{snapshot.positions.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td>{position.item.category}</td><td>{position.item.unit}</td><td className="num">{position.item.reorderLevel}</td><td className="num">{money(position.item.unitCostCents)}</td><td className="num">{position.item.sellingPriceCents == null ? 'Not set' : money(position.item.sellingPriceCents)}</td><td className="num"><b>{position.closing}</b></td><td className="num">{money(position.valueCents)}</td></tr>)}</tbody></table></div> : <Empty text="No items yet." />}</Panel>
  </State>;
}

function SellingPrices() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const catalog = snapshot?.items ?? [];
  const selected = catalog.find((item) => item.id === itemId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selected || price === '') return;
    await mutate(() => api.updateSellingPrice(accessToken, selected.id, Math.round(Number(price) * 100)), `Selling price updated for ${selected.name}.`);
    setItemId('');
    setPrice('');
  };
  return <Panel title="Selling prices" subtitle="One price per item across all shops. Past sales keep their original price." className="spaced">
    <form className="form-grid place-form" onSubmit={(event) => void submit(event).catch(() => {})}>
      <label><span>Item</span><SelectControl aria-label="Item" required value={itemId} disabled={busy} onChange={(event) => {
        const item = catalog.find((candidate) => candidate.id === event.target.value);
        setItemId(event.target.value);
        setPrice(item?.sellingPriceCents == null ? '' : (item.sellingPriceCents / 100).toFixed(2));
      }}><option value="">Select item</option>{catalog.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sellingPriceCents == null ? 'Not set' : money(item.sellingPriceCents)}</option>)}</SelectControl></label>
      <label><span>Selling price</span><input type="number" min="0" max="21474836.47" step="0.01" required disabled={busy || !selected} value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      <button className="button" disabled={busy || !selected || price === ''}>Save price<Check size={16} /></button>
    </form>
  </Panel>;
}

function Sell() {
  const { accessToken, user } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [form, setForm] = useState({ itemId: '', quantity: '' });
  const shop = snapshot?.locations.find((place) => place.id === user?.locationId) ?? snapshot?.locations[0];
  const stocked = snapshot?.positions.filter((position) => position.closing > 0) ?? [];
  const selected = stocked.find((position) => position.item.id === form.itemId);
  const unitPriceCents = selected?.item.sellingPriceCents;
  const totalCents = unitPriceCents == null || !form.quantity ? null : unitPriceCents * Number(form.quantity);
  const sales = snapshot?.movements.filter((movement) => movement.type === 'sale') ?? [];
  if (user?.role !== 'shop_attendant') return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !user.locationId || !selected || unitPriceCents == null) return;
    const quantity = Number(form.quantity);
    await mutate(() => api.addMovement(accessToken, {
      itemId: selected.item.id,
      locationId: user.locationId!,
      type: 'sale',
      quantity,
      expectedUnitPriceCents: unitPriceCents,
      movementDate: new Date().toISOString().slice(0, 10),
    }), `Sold ${quantity} ${selected.item.unit} of ${selected.item.name}.`);
    setForm({ itemId: '', quantity: '' });
  };

  return <State>
    <Header title="Sell" subtitle={shop ? `A sale reduces stock at ${shop.name} only.` : 'A sale reduces stock at your shop only.'} />
    <Panel title="Record a sale" subtitle="Pick an item that is on the shelf.">
      {stocked.length ? <form className="form-grid sell-form" onSubmit={(event) => void submit(event).catch(() => {})}>
        <label>
          <span>Item</span>
          <SelectControl aria-label="Item" required value={form.itemId} onChange={(event) => setForm({ itemId: event.target.value, quantity: '' })}>
            <option value="">Select item</option>
            {stocked.map((position) => <option key={position.item.id} value={position.item.id}>{position.item.name}</option>)}
          </SelectControl>
        </label>
        <label>
          <span className="label-row"><span>Quantity</span><span className="info-tooltip"><button type="button" aria-label="Stock on hand" aria-describedby="sale-quantity-hint"><Info size={14} /></button><span id="sale-quantity-hint" role="tooltip">{selected ? `${selected.closing} ${selected.item.unit} on hand` : 'Choose an item to see what is on hand'}</span></span></span>
          <input type="number" min="1" max={selected?.closing} required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
        </label>
        <label><span>Unit price</span><input readOnly value={unitPriceCents == null ? 'Not set' : money(unitPriceCents)} /></label>
        <label><span>Total</span><output className="sale-total" aria-live="polite">{totalCents == null ? '—' : money(totalCents)}</output></label>
        <button className="button" disabled={busy || !selected || unitPriceCents == null}>Sell<ArrowUpRight size={16} /></button>
        {selected && unitPriceCents == null && <p className="price-hint" role="status">Ask an administrator to set a selling price for this item.</p>}
      </form> : <Empty text="Nothing to sell yet. Stock arrives when someone transfers it to this shop." />}
    </Panel>
    <Panel title={`Recent sales (${sales.length})`} className="spaced">
      {sales.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td>{formatDate(sale.movementDate)}</td><td><b>{sale.item?.name ?? 'Deleted item'}</b><small>{sale.item?.sku}</small></td><td className="num negative">−{sale.quantity}</td><td className="num">{sale.unitPriceCents == null ? 'Not recorded' : money(sale.unitPriceCents)}</td><td className="num">{sale.saleTotalCents == null ? 'Not recorded' : money(sale.saleTotalCents)}</td></tr>)}</tbody></table></div> : <Empty text="No sales recorded at this shop yet." />}
    </Panel>
  </State>;
}

function Movements() {
  const { accessToken, user } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [filter, setFilter] = useState<'all' | MovementType>('all');
  const [form, setForm] = useState({ itemId: '', locationId: '', destinationLocationId: '', type: 'purchase' as MovementType, quantity: '', movementDate: new Date().toISOString().slice(0, 10), reference: '', note: '' });
  const items = [...new Map((snapshot?.positions ?? []).map((position) => [position.item.id, position.item])).values()];
  const places = snapshot?.locations ?? [];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addMovement(accessToken, {
      itemId: form.itemId,
      locationId: form.locationId,
      destinationLocationId: form.type === 'transfer' ? form.destinationLocationId : undefined,
      type: form.type,
      quantity: Number(form.quantity),
      movementDate: form.movementDate,
      reference: form.reference,
      note: form.note,
    }), `${movementMeta[form.type].label} was recorded.`);
    setForm((current) => ({ ...current, quantity: '', reference: '', note: '' }));
  };
  const rows = snapshot?.movements.filter((movement) => filter === 'all' || movement.type === filter) ?? [];
  if (user?.role === 'shop_attendant') return <Navigate to="/" replace />;
  return <State><Header title="Stock movements" subtitle="Receipts stay in one place. A transfer leaves one place and arrives at another." />
    <Panel title="Record movement" subtitle="The ledger updates both balances immediately"><form className="form-grid movement-form" onSubmit={(event) => void submit(event)}>
      <label><span>Item</span><SelectControl required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl></label>
      <label><span className="label-row"><span>Movement type</span><span className="info-tooltip"><button type="button" aria-label="About movement type" aria-describedby="movement-type-hint"><Info size={14} /></button><span id="movement-type-hint" role="tooltip">{movementMeta[form.type].hint}</span></span></span><SelectControl value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MovementType, destinationLocationId: '' })}>{(Object.entries(movementMeta) as [MovementType, { label: string; hint: string }][]).filter(([value]) => value !== 'sale').map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</SelectControl></label>
      <label><span>{form.type === 'transfer' ? 'From' : 'Place'}</span><SelectControl required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">Select place</option>{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</SelectControl></label>
      {form.type === 'transfer' && <label><span>To</span><SelectControl required value={form.destinationLocationId} onChange={(event) => setForm({ ...form, destinationLocationId: event.target.value })}><option value="">Select place</option>{places.filter((place) => place.id !== form.locationId).map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</SelectControl></label>}
      <label><span>Quantity</span><input type="number" min="1" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
      <label><span>Date</span><input type="date" required value={form.movementDate} onChange={(event) => setForm({ ...form, movementDate: event.target.value })} /></label>
      <label><span>Reference</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
      <label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
      <button className="button" disabled={busy || !items.length}>Save movement<ArrowUpRight size={16} /></button>
    </form></Panel>
    <Panel title={`Movement ledger (${rows.length})`} className="spaced"><div className="filter-row"><label><span className="sr-only">Filter movement type</span><SelectControl value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All movement types</option>{Object.entries(movementMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</SelectControl></label></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Place</th><th>Reference</th><th className="num">Qty</th><th className="num">Sale price</th><th className="num">Sale total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((movement) => <tr key={movement.id}><td>{formatDate(movement.movementDate)}</td><td><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movement.note}</small></td><td>{movementMeta[movement.type].label}</td><td>{movement.destination ? `${movement.location?.name ?? 'Unknown'} → ${movement.destination.name}` : movement.location?.name ?? 'Unknown'}</td><td>{movement.reference || '—'}</td><td className={`num ${movement.sign === 1 ? 'positive' : 'negative'}`}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</td><td className="num">{movement.type !== 'sale' ? '—' : movement.unitPriceCents == null ? 'Not recorded' : money(movement.unitPriceCents)}</td><td className="num">{movement.type !== 'sale' ? '—' : movement.saleTotalCents == null ? 'Not recorded' : money(movement.saleTotalCents)}</td><td className="num"><button className="icon-button" aria-label="Delete movement" disabled={busy} onClick={() => accessToken && void mutate(() => api.deleteMovement(accessToken, movement.id), 'The stock movement was removed.')}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div> : <Empty text="No movements match this filter." />}</Panel>
  </State>;
}

function Reports() {
  const { snapshot, days, setDays } = useStore();
  const [tab, setTab] = useState<'current' | 'low' | 'fast' | 'slow' | 'dead'>('current');
  const rows = snapshot?.positions.filter((position) => tab === 'current' || (tab === 'low' ? position.isLowStock : position.velocity === tab)) ?? [];
  const labels = { current: 'Current stock', low: 'Low stock', fast: 'Fast movers', slow: 'Slow movers', dead: 'Dead stock' };
  return <State><Header title="Reports" subtitle={`Sales and transfers out of each place over the last ${days} days.`} actions={<><PlaceFilter /><SelectControl value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></SelectControl></>} />
    <div className="tabs" role="tablist">{(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <button role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{labels[key]} ({key === 'current' ? snapshot?.positions.length : snapshot?.positions.filter((position) => key === 'low' ? position.isLowStock : position.velocity === key).length})</button>)}</div>
    <Panel title={labels[tab]} subtitle={tab === 'current' ? 'Closing = opening + purchases + returns in + transfers in − transfers out − supplier returns − damaged − sales.' : undefined}>{rows.length ? (tab === 'current' ? <StockTable positions={rows} /> : <div className="table-wrap"><table><thead><tr><th>Item</th><th>Place</th><th className="num">Sold or transferred</th><th className="num">Closing</th><th className="num">Value held</th><th className="num">Last time out</th></tr></thead><tbody>{rows.map((position) => <tr key={`${position.location.id}-${position.item.id}`}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td>{position.location.name}</td><td className="num">{position.outLastPeriod}</td><td className="num">{position.closing}</td><td className="num">{money(position.valueCents)}</td><td className="num">{position.lastOutDate ? formatDate(position.lastOutDate) : 'Never'}</td></tr>)}</tbody></table></div>) : <Empty text="No items in this report." />}</Panel>
  </State>;
}

function Places() {
  const { accessToken, user } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [form, setForm] = useState({ name: '', type: 'shop' as LocationType });
  if (user?.role !== 'administrator') return <Navigate to="/" replace />;
  const places = snapshot?.locations ?? [];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addLocation(accessToken, form), `${form.name} was added.`);
    setForm({ name: '', type: 'shop' });
  };
  return <State>
    <Header title="Places" subtitle="Warehouses and shops that hold their own stock." />
    <Panel title="Add a place" subtitle="A transfer can move stock between any of these.">
      <form className="form-grid place-form" onSubmit={(event) => void submit(event)}>
        <label><span>Name</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label><span>Type</span><SelectControl value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as LocationType })}><option value="shop">Shop</option><option value="warehouse">Warehouse</option></SelectControl></label>
        <button className="button" disabled={busy}>Add place<ArrowUpRight size={16} /></button>
      </form>
    </Panel>
    <Panel title={`Places (${places.length})`} className="spaced">{places.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>{places.map((place: Place) => <tr key={place.id}><td><b>{place.name}</b></td><td>{placeLabel[place.type]}</td></tr>)}</tbody></table></div> : <Empty text="No places yet." />}</Panel>
  </State>;
}

const joinedOn = (value: string) =>
  new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

function Team() {
  const { accessToken, user, signOut } = useAuth();
  const { notify, snapshot } = useStore();
  const [people, setPeople] = useState<User[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'inventory_manager' as 'inventory_manager' | 'shop_attendant', locationId: '' });
  const shops = snapshot?.locations.filter((place) => place.type === 'shop') ?? [];

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setListError(null);
    try {
      setPeople(await api.users(accessToken));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      setListError(caught instanceof Error ? caught.message : 'Could not load accounts');
    } finally {
      setLoading(false);
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    if (user?.role !== 'administrator') return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, user?.role]);

  if (user?.role !== 'administrator') return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await api.addUser(accessToken, {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
        locationId: form.role === 'shop_attendant' ? form.locationId : undefined,
      });
      setPeople((current) =>
        [...(current ?? []).filter((person) => person.id !== created.id), created]
          .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.email.localeCompare(right.email)),
      );
      notify(`${created.fullName} can sign in with the password you chose.`, 'Account created');
      setForm({ fullName: '', email: '', password: '', role: 'inventory_manager', locationId: '' });
      setShowPassword(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setFormError(caught instanceof Error ? caught.message : 'Could not add this account');
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <Header title="Team" subtitle="Add inventory managers and shop attendants." />
    <Panel title="Add a person" subtitle="Inventory managers move stock between places. A shop attendant is assigned to one shop.">
      <form className="form-grid team-form" onSubmit={(event) => void submit(event)}>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <label>
          <span>Full name</span>
          <input autoComplete="name" required maxLength={120} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
        </label>
        <label>
          <span>Email address</span>
          <input autoComplete="off" inputMode="email" required type="email" maxLength={255} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>
          <span>Role</span>
          <SelectControl value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as typeof form.role, locationId: '' })}>
            <option value="inventory_manager">Inventory manager</option>
            <option value="shop_attendant">Shop attendant</option>
          </SelectControl>
        </label>
        {form.role === 'shop_attendant' && <label>
          <span>Shop</span>
          <SelectControl required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}>
            <option value="">Select shop</option>
            {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </SelectControl>
        </label>}
        <label>
          <span>Password</span>
          <span className="password-field">
            <input autoComplete="new-password" minLength={8} maxLength={128} placeholder="At least 8 characters" required type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <button className="button" disabled={submitting}>
          {submitting ? <><StockLedgerMark animated size={20} />Adding</> : <>Add person<ArrowUpRight size={16} /></>}
        </button>
      </form>
    </Panel>
    <Panel title={`People (${people?.length ?? 0})`} className="spaced">
      {loading && !people ? <div className="empty"><StockLedgerMark animated size={32} /><p>Loading accounts</p></div>
        : listError && !people ? <div className="empty"><p>{listError}</p><button className="button secondary" onClick={() => void load()}>Try again</button></div>
          : people?.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Place</th><th className="num">Joined</th></tr></thead><tbody>{people.map((person) => <tr key={person.id}><td><b>{person.fullName}</b></td><td>{person.email}</td><td>{roleLabel[person.role]}</td><td>{snapshot?.locations.find((place) => place.id === person.locationId)?.name ?? 'All places'}</td><td className="num">{joinedOn(person.createdAt)}</td></tr>)}</tbody></table></div>
            : <div className="empty"><Users size={22} /><p>No accounts yet.</p></div>}
    </Panel>
  </>;
}
