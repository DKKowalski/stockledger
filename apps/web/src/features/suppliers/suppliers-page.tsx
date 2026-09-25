import { Archive, ArrowUpRight, RotateCcw, Truck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError, api } from '../../api';
import { useAuth } from '../../auth-context';
import { EmptyState, PageHeader, Panel } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import type { Supplier } from '../../types';

export function SuppliersPage() {
  const { accessToken, signOut } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setSuppliers(await api.suppliers(accessToken));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) signOut();
      else setError(caught instanceof Error ? caught.message : 'Could not load suppliers');
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
    try {
      const supplier = await api.addSupplier(accessToken, {
        name: form.name,
        ...(form.email ? { email: form.email } : {}),
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.address ? { address: form.address } : {}),
      });
      setSuppliers((current) => [...(current ?? []), supplier].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ name: '', email: '', phone: '', address: '' });
      toast.success('Supplier added', { description: `${supplier.name} can now be selected on purchases.` });
    } catch (caught) {
      toast.error('Could not add supplier', { description: caught instanceof Error ? caught.message : 'Try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = async (supplier: Supplier) => {
    if (!accessToken) return;
    setBusyId(supplier.id);
    try {
      const updated = await api.updateSupplier(accessToken, supplier.id, { isActive: !supplier.isActive });
      setSuppliers((current) => current?.map((entry) => entry.id === updated.id ? updated : entry) ?? null);
      toast.success(updated.isActive ? 'Supplier restored' : 'Supplier archived');
    } catch (caught) {
      toast.error('Could not update supplier', { description: caught instanceof Error ? caught.message : 'Try again.' });
    } finally {
      setBusyId(null);
    }
  };

  return <>
    <PageHeader title="Suppliers" subtitle="Keep purchase sources and contact details together." />
    <Panel title="Add supplier" subtitle="Contact details are optional.">
      <form className="form-grid supplier-form" onSubmit={(event) => void submit(event)}>
        <label><span>Name</span><InputControl required maxLength={120} value={form.name} onValueChange={(name) => setForm({ ...form, name })} /></label>
        <label><span>Email</span><InputControl type="email" maxLength={255} value={form.email} onValueChange={(email) => setForm({ ...form, email })} /></label>
        <label><span>Phone</span><InputControl maxLength={40} value={form.phone} onValueChange={(phone) => setForm({ ...form, phone })} /></label>
        <label><span>Address</span><InputControl maxLength={300} value={form.address} onValueChange={(address) => setForm({ ...form, address })} /></label>
        <button className="button" disabled={submitting}>{submitting ? 'Adding' : <>Add supplier<ArrowUpRight size={16} /></>}</button>
      </form>
    </Panel>
    <Panel title={`Supplier directory (${suppliers?.length ?? 0})`} className="spaced">
      {error ? <div className="form-error team-action-error" role="alert">{error}</div> : null}
      {suppliers?.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{suppliers.map((supplier) => <tr className={supplier.isActive ? '' : 'inactive-account-row'} key={supplier.id}><td><b>{supplier.name}</b></td><td>{supplier.email || '—'}</td><td>{supplier.phone || '—'}</td><td>{supplier.address || '—'}</td><td><span className={`account-status ${supplier.isActive ? 'active' : 'inactive'}`}><i />{supplier.isActive ? 'Active' : 'Archived'}</span></td><td className="num"><button className="icon-button" aria-label={`${supplier.isActive ? 'Archive' : 'Restore'} ${supplier.name}`} disabled={busyId === supplier.id} onClick={() => void toggle(supplier)}>{supplier.isActive ? <Archive size={16} /> : <RotateCcw size={16} />}</button></td></tr>)}</tbody></table></div> : suppliers ? <EmptyState icon={<Truck size={21} />} text="No suppliers yet." /> : <div className="empty"><p>Loading suppliers</p></div>}
    </Panel>
  </>;
}
