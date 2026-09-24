import { ArrowUpRight, Eye, EyeOff, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import { PageHeader, Panel, SelectControl } from '../../components/inventory-ui';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { InputControl } from '../../components/ui/input-control';
import { joinedOn, roleLabel } from '../../lib/presentation';
import type { User } from '../../types';

export function TeamPage() {
  const { accessToken, signOut } = useAuth();
  const { notify, snapshot } = useInventoryStore();
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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

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
      setPeople((current) => [...(current ?? []).filter((person) => person.id !== created.id), created]
        .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.email.localeCompare(right.email)));
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
    <PageHeader title="Team" subtitle="Add inventory managers and shop attendants." />
    <Panel title="Add a person" subtitle="Managers work across places. Each shop attendant belongs to one shop.">
      <form className="form-grid team-form" onSubmit={(event) => void submit(event)}>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <label><span>Full name</span><InputControl autoComplete="name" required maxLength={120} value={form.fullName} onValueChange={(fullName) => setForm({ ...form, fullName })} /></label>
        <label><span>Email address</span><InputControl autoComplete="off" inputMode="email" required type="email" maxLength={255} value={form.email} onValueChange={(email) => setForm({ ...form, email })} /></label>
        <label><span>Role</span><SelectControl aria-label="Role" value={form.role} onValueChange={(role) => setForm({ ...form, role: role as typeof form.role, locationId: '' })} options={[{ value: 'inventory_manager', label: 'Inventory manager' }, { value: 'shop_attendant', label: 'Shop attendant' }]} /></label>
        {form.role === 'shop_attendant' && <label><span>Shop</span><SelectControl aria-label="Shop" required value={form.locationId} onValueChange={(locationId) => setForm({ ...form, locationId })} options={[{ value: '', label: 'Select shop' }, ...shops.map((shop) => ({ value: shop.id, label: shop.name }))]} /></label>}
        <label><span>Password</span><span className="password-field"><InputControl autoComplete="new-password" minLength={8} maxLength={128} placeholder="At least 8 characters" required type={showPassword ? 'text' : 'password'} value={form.password} onValueChange={(password) => setForm({ ...form, password })} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        <button className="button" disabled={submitting}>{submitting ? <><StockLedgerMark animated size={20} />Adding</> : <>Add person<ArrowUpRight size={16} /></>}</button>
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
