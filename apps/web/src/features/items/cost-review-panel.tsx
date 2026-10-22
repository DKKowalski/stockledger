import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { useCompanySettings } from '../../app/company-settings-store';
import { Panel, SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { safeErrorMessage } from '../../lib/user-facing-error';
import { formatMoney } from '../../lib/presentation';
import type { CostReview, CostReviewSource } from '../../types';

export function CostReviewPanel() {
  const { accessToken } = useAuth();
  const { snapshot } = useInventoryStore();
  const { terms } = useCompanySettings();
  const [available, setAvailable] = useState(false);
  const [itemId, setItemId] = useState('');
  useEffect(() => {
    let active = true;
    if (accessToken) void api.costReviewStatus(accessToken).then((result) => { if (active) setAvailable(result.available); }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [accessToken]);
  if (!available) return null;
  const items = snapshot?.items.filter((item) => item.isActive) ?? [];
  const item = items.find((value) => value.id === itemId);
  return <Panel title="Review purchase costs" subtitle="Development review of current costs. Historical profit stays unchanged." className="spaced cost-review-panel">
    <label className="pricing-item-select"><span>{terms.Item}</span><SelectControl aria-label="Cost review item" value={itemId} onValueChange={setItemId} options={[{ value: '', label: `Select ${terms.item}` }, ...items.map((value) => ({ value: value.id, label: value.name }))]} /></label>
    {item && <CostReviewEditor key={`${item.id}:${item.updatedAt}`} itemId={item.id} />}
  </Panel>;
}

function CostReviewEditor({ itemId }: { itemId: string }) {
  const { accessToken } = useAuth();
  const [current, setCurrent] = useState<CostReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<CostReviewSource | ''>('');
  const [reference, setReference] = useState('');
  const [freeConfirmed, setFreeConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    if (accessToken) void api.costReview(accessToken, itemId).then((result) => {
      if (active) { setCurrent(result); setError(null); setSource(''); setReference(''); setFreeConfirmed(false); setEditing(false); }
    }).catch((caught: unknown) => { if (active) setError(safeErrorMessage(caught, 'Could not load the current cost.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, itemId, revision]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !current || pending || error) return;
    const evidenceSource = current.item.unitCostCents === 0 ? (freeConfirmed ? 'free_acquisition' : '') : source;
    if (!evidenceSource || !reference.trim()) return;
    setPending(true);
    try {
      const result = await api.confirmCost(accessToken, itemId, {
        expectedCostCents: current.item.unitCostCents, expectedUnit: current.item.unit, expectedItemUpdatedAt: current.item.updatedAt,
        expectedCurrency: current.currency,
        source: evidenceSource, reference: reference.trim(), confirmed: true,
      });
      setCurrent(result); setEditing(false); setFreeConfirmed(false); setReference(''); setSource('');
    } catch (caught) { setError(safeErrorMessage(caught, 'Could not confirm the cost. Reload the current cost before trying again.')); }
    finally { setPending(false); }
  };
  if (loading) return <p className="cost-review-body" role="status">Loading current cost</p>;
  return <div className="cost-review-body">
    {error && <div className="form-error" role="alert">{error}<button className="button secondary" disabled={pending} onClick={() => { setLoading(true); setRevision((value) => value + 1); }} type="button">Reload current cost</button></div>}
    {current && <>
      <div className="pricing-current-price"><span>Current unit cost</span><strong>{formatMoney(current.item.unitCostCents, current.currency)} <small>per {current.item.unit}</small></strong></div>
      <p role="status">{current.state === 'confirmed' ? (current.review?.source === 'free_acquisition' ? 'Confirmed as stock acquired free of charge.' : 'Current cost confirmed by an administrator.') : current.state === 'changed' ? 'Cost details changed since the last review. Check them again.' : 'This current cost has not been reviewed.'}</p>
      {current.state === 'confirmed' && current.review && !editing ? <div className="cost-review-record">
        <p>Record reference: <strong>{current.review.reference}</strong></p>
        <button className="button secondary" type="button" onClick={() => setEditing(true)}>Review another record</button>
      </div> : <form className="cost-review-form" onSubmit={(event) => void submit(event)}><fieldset disabled={pending || !!error || !current.available || !current.item.isActive}>
        {current.item.unitCostCents === 0 ? <div className="cost-review-zero">
          <p>If the cost is missing, correct it under Catalog maintenance before confirming.</p>
          <label className="pricing-checkbox"><input type="checkbox" required checked={freeConfirmed} onChange={(event) => setFreeConfirmed(event.target.checked)} />This stock was acquired free of charge.</label>
        </div> : <label><span>Records checked</span><SelectControl aria-label="Records checked" required value={source} onValueChange={(value) => setSource(value as CostReviewSource | '')} options={[{ value: '', label: 'Choose records' }, { value: 'purchase_records', label: 'Purchase records' }, { value: 'opening_records', label: 'Opening stock records' }]} /></label>}
        <label><span>Record reference</span><InputControl required maxLength={200} value={reference} onValueChange={setReference} placeholder="Receipt number, opening sheet or source note" /></label>
        <button className="button" disabled={!reference.trim() || (current.item.unitCostCents === 0 ? !freeConfirmed : !source)} type="submit">{pending ? 'Confirming' : 'Confirm current cost'}</button>
      </fieldset></form>}
    </>}
  </div>;
}
