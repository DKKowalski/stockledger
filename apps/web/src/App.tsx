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
  Menu,
  Package,
  PackageOpen,
  PackageX,
  RefreshCw,
  Trash2,
  TrendingUp,
  TriangleAlert,
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
import type { MovementType, Position, Snapshot } from './types';

const movementMeta: Record<MovementType, { label: string; hint: string }> = {
  purchase: { label: 'Purchase', hint: 'Goods received into the warehouse' },
  transfer: { label: 'Transfer to shop', hint: 'Warehouse to main shop movement' },
  return_in: { label: 'Return in', hint: 'Goods returned from the shop' },
  return_out: { label: 'Return to supplier', hint: 'Goods sent back to the supplier' },
  damage: { label: 'Damaged stock', hint: 'Stock written off as damaged' },
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
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
  refresh: () => Promise<void>;
  notice: { id: number; message: string; visible: boolean } | null;
  dismissNotice: () => void;
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
        <Route path="items" element={<Items />} />
        <Route path="movements" element={<Movements />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to={accessToken ? '/' : '/login'} replace />} />
    </Routes>
  );
}

function AppLoader() {
  return (
    <div className="app-loader" role="status">
      <span className="brand-mark"><StockLedgerMark /></span>
      <RefreshCw className="spin" size={18} />
      <span className="sr-only">Restoring session</span>
    </div>
  );
}

function InventoryProvider({ children }: { children: ReactNode }) {
  const { accessToken, signOut } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [notice, setNotice] = useState<{ id: number; message: string; visible: boolean } | null>(null);
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
      setSnapshot(await api.snapshot(accessToken, days));
    } catch (caught) {
      handleError(caught, 'Could not load inventory');
    } finally {
      setLoading(false);
    }
  }, [accessToken, days, handleError]);

  useEffect(() => {
    let cancelled = false;

    void api.snapshot(accessToken, days)
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
  }, [accessToken, days, handleError]);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice((current) => current ? { ...current, visible: false } : null);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 180);
  }, []);

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    const id = ++noticeId.current;
    setNotice({ id, message, visible: true });
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
      setSnapshot(await api.snapshot(accessToken, days));
      showNotice(successMessage);
    } catch (caught) {
      handleError(caught, 'Request failed');
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [accessToken, days, handleError, showNotice]);

  const store = useMemo(
    () => ({ snapshot, loading, busy, error, days, setDays, refresh, notice, dismissNotice, mutate }),
    [snapshot, loading, busy, error, days, refresh, notice, dismissNotice, mutate],
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
              {submitting ? <><RefreshCw className="spin" size={17} />Signing in</> : <>Sign in<ArrowUpRight size={17} /></>}
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
  const links = [
    ['/', 'Overview', LayoutDashboard],
    ['/items', 'Items', Package],
    ['/movements', 'Stock movements', ArrowLeftRight],
    ['/reports', 'Reports', ChartColumn],
  ] as const;
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
              <span className="topbar-user-copy"><b>{user?.fullName}</b><small>{user?.role === 'administrator' ? 'Administrator' : 'Inventory manager'}</small></span>
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
          <div><b>Inventory updated</b><span>{notice.message}</span></div>
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
  if (loading && !snapshot) return <div className="empty page-state"><RefreshCw className="spin" /><p>Loading inventory</p></div>;
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

function Dashboard() {
  const { snapshot, refresh, loading } = useStore();
  const { user } = useAuth();
  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return <State>{snapshot && <>
    <Header title={`Welcome back, ${firstName}`} subtitle="Here is what is happening across your warehouse today." actions={<><button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} />Refresh</button><NavLink className="button" to="/movements">Record movement<ArrowUpRight size={16} /></NavLink></>} />
    <section className="kpi-grid">
      <Kpi icon={Warehouse} label="Closing stock" value={snapshot.summary.closingUnits.toLocaleString()} note={`${money(snapshot.summary.stockValueCents)} at cost`} />
      <Kpi icon={TriangleAlert} label="Low stock items" value={String(snapshot.summary.lowStockItems)} note="At or below reorder level" tone="warning" />
      <Kpi icon={PackageX} label="Damaged units" value={snapshot.summary.damagedUnits.toLocaleString()} note="Written off to date" tone="danger" />
      <Kpi icon={TrendingUp} label="Dead stock lines" value={String(snapshot.summary.deadStockLines)} note={`No shop transfer in ${snapshot.periodDays} days`} tone="success" />
    </section>
    <section className="insights-grid">
      <StockLevels positions={snapshot.positions} />
      <StockHealth positions={snapshot.positions} />
    </section>
    <section className="dashboard-grid">
      <Panel title="Recent movements" subtitle="Latest warehouse activity" className="movement-panel">
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
      { key: 'in', label: 'Stock in', value: position.purchases + position.returnsIn },
      { key: 'out', label: 'Stock out', value: position.transferred + position.returnsOut + position.damaged },
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
          <div className="chart-group" key={position.item.id} title={position.item.name}>
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
    return <div className="low-stock-row" key={position.item.id}>
      <div><b>{position.item.name}</b><small>{position.closing} of {position.item.reorderLevel} {position.item.unit}</small></div>
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
  return <div className="table-wrap"><table><thead><tr><th>Item</th><th className="num">Opening</th>{!compact && <><th className="num">Purchases</th><th className="num">Returns in</th></>}<th className="num">In</th><th className="num">Out</th><th className="num">Closing</th>{!compact && <th className="num">Value</th>}</tr></thead><tbody>{positions.map((p) => <tr key={p.item.id}><td><b>{p.item.name}</b><small>{p.item.sku}</small></td><td className="num">{p.opening}</td>{!compact && <><td className="num">{p.purchases}</td><td className="num">{p.returnsIn}</td></>}<td className="num positive">+{p.purchases + p.returnsIn}</td><td className="num negative">−{p.transferred + p.returnsOut + p.damaged}</td><td className="num"><b>{p.closing}</b>{p.isLowStock && <span className="badge">low</span>}</td>{!compact && <td className="num">{money(p.valueCents)}</td>}</tr>)}</tbody></table></div>;
}

function Items() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', openingStock: '0' });
  const change = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addItem(accessToken, { sku: form.sku, name: form.name, category: form.category || 'General', unit: form.unit || 'pcs', reorderLevel: Number(form.reorderLevel), unitCostCents: Math.round(Number(form.unitCost) * 100), openingStock: Number(form.openingStock) }), `${form.name} was added to inventory.`);
    setForm({ sku: '', name: '', category: '', unit: 'pcs', reorderLevel: '10', unitCost: '0', openingStock: '0' });
  };
  return <State><Header title="Items" subtitle="Manage your item master, opening balances, and reorder levels." />
    <Panel title="Add item" subtitle="Create a new warehouse stock line"><form className="form-grid item-form" onSubmit={(event) => void submit(event)}>{(['sku', 'name', 'category', 'unit'] as const).map((key) => <label key={key}><span>{key === 'sku' ? 'SKU' : key[0].toUpperCase() + key.slice(1)}</span><input required={key === 'sku' || key === 'name'} value={form[key]} onChange={(event) => change(key, event.target.value)} /></label>)}<label><span>Reorder level</span><input type="number" min="0" required value={form.reorderLevel} onChange={(event) => change('reorderLevel', event.target.value)} /></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" required value={form.unitCost} onChange={(event) => change('unitCost', event.target.value)} /></label><label><span>Opening stock</span><input type="number" min="0" required value={form.openingStock} onChange={(event) => change('openingStock', event.target.value)} /></label><button className="button" disabled={busy}>Add item<ArrowUpRight size={16} /></button></form></Panel>
    <Panel title={`Item master (${snapshot?.positions.length ?? 0})`} className="spaced">{snapshot?.positions.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th className="num">Reorder</th><th className="num">Cost</th><th className="num">Closing</th><th className="num">Value</th></tr></thead><tbody>{snapshot.positions.map((p) => <tr key={p.item.id}><td><b>{p.item.name}</b><small>{p.item.sku}</small></td><td>{p.item.category}</td><td>{p.item.unit}</td><td className="num">{p.item.reorderLevel}</td><td className="num">{money(p.item.unitCostCents)}</td><td className="num"><b>{p.closing}</b></td><td className="num">{money(p.valueCents)}</td></tr>)}</tbody></table></div> : <Empty text="No items yet." />}</Panel>
  </State>;
}

function Movements() {
  const { accessToken } = useAuth();
  const { snapshot, mutate, busy } = useStore();
  const [filter, setFilter] = useState<'all' | MovementType>('all');
  const [form, setForm] = useState({ itemId: '', type: 'purchase' as MovementType, quantity: '', movementDate: new Date().toISOString().slice(0, 10), reference: '', note: '' });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    await mutate(() => api.addMovement(accessToken, { ...form, quantity: Number(form.quantity) }), `${movementMeta[form.type].label} was recorded.`);
    setForm((current) => ({ ...current, quantity: '', reference: '', note: '' }));
  };
  const rows = snapshot?.movements.filter((movement) => filter === 'all' || movement.type === filter) ?? [];
  return <State><Header title="Stock movements" subtitle="Record each receipt, transfer, return, and write-off." />
    <Panel title="Record movement" subtitle="The ledger updates the current balance immediately"><form className="form-grid movement-form" onSubmit={(event) => void submit(event)}><label><span>Item</span><SelectControl required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}><option value="">Select item</option>{snapshot?.positions.map((position) => <option key={position.item.id} value={position.item.id}>{position.item.name} ({position.closing} {position.item.unit})</option>)}</SelectControl></label><label><span className="label-row"><span>Movement type</span><span className="info-tooltip"><button type="button" aria-label="About movement type" aria-describedby="movement-type-hint"><Info size={14} /></button><span id="movement-type-hint" role="tooltip">{movementMeta[form.type].hint}</span></span></span><SelectControl value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MovementType })}>{Object.entries(movementMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</SelectControl></label><label><span>Quantity</span><input type="number" min="1" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label><span>Date</span><input type="date" required value={form.movementDate} onChange={(event) => setForm({ ...form, movementDate: event.target.value })} /></label><label><span>Reference</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label><label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><button className="button" disabled={busy || !snapshot?.positions.length}>Save movement<ArrowUpRight size={16} /></button></form></Panel>
    <Panel title={`Movement ledger (${rows.length})`} className="spaced"><div className="filter-row"><label><span className="sr-only">Filter movement type</span><SelectControl value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All movement types</option>{Object.entries(movementMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</SelectControl></label></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Reference</th><th className="num">Qty</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((movement) => <tr key={movement.id}><td>{formatDate(movement.movementDate)}</td><td><b>{movement.item?.name ?? 'Deleted item'}</b><small>{movement.note}</small></td><td>{movementMeta[movement.type].label}</td><td>{movement.reference || '—'}</td><td className={`num ${movement.sign === 1 ? 'positive' : 'negative'}`}>{movement.sign === 1 ? '+' : '−'}{movement.quantity}</td><td className="num"><button className="icon-button" aria-label="Delete movement" disabled={busy} onClick={() => accessToken && void mutate(() => api.deleteMovement(accessToken, movement.id), 'The stock movement was removed.')}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div> : <Empty text="No movements match this filter." />}</Panel>
  </State>;
}

function Reports() {
  const { snapshot, days, setDays } = useStore();
  const [tab, setTab] = useState<'current' | 'low' | 'fast' | 'slow' | 'dead'>('current');
  const rows = snapshot?.positions.filter((position) => tab === 'current' || (tab === 'low' ? position.isLowStock : position.velocity === tab)) ?? [];
  const labels = { current: 'Current stock', low: 'Low stock', fast: 'Fast movers', slow: 'Slow movers', dead: 'Dead stock' };
  return <State><Header title="Reports" subtitle={`Movement analysis based on shop transfers in the last ${days} days.`} actions={<SelectControl value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></SelectControl>} />
    <div className="tabs" role="tablist">{(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <button role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{labels[key]} ({key === 'current' ? snapshot?.positions.length : snapshot?.positions.filter((position) => key === 'low' ? position.isLowStock : position.velocity === key).length})</button>)}</div>
    <Panel title={labels[tab]} subtitle={tab === 'current' ? 'Closing = opening + purchases + returns in − transfers − supplier returns − damaged.' : undefined}>{rows.length ? (tab === 'current' ? <StockTable positions={rows} /> : <div className="table-wrap"><table><thead><tr><th>Item</th><th className="num">Transferred</th><th className="num">Closing</th><th className="num">Value held</th><th className="num">Last transfer</th></tr></thead><tbody>{rows.map((position) => <tr key={position.item.id}><td><b>{position.item.name}</b><small>{position.item.sku}</small></td><td className="num">{position.outLastPeriod}</td><td className="num">{position.closing}</td><td className="num">{money(position.valueCents)}</td><td className="num">{position.lastOutDate ? formatDate(position.lastOutDate) : 'Never'}</td></tr>)}</tbody></table></div>) : <Empty text="No items in this report." />}</Panel>
  </State>;
}
