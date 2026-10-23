import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { useCompanySettings } from '../../app/company-settings-store';
import { SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { safeErrorMessage } from '../../lib/user-facing-error';
import type { Item, PricingQuote, PricingVersion } from '../../types';

function cents(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter a price with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > 2147483647n) throw new Error('The price is too large.');
  return Number(amount);
}

// The summary reads prices while the owner is still typing, so a half-typed price is skipped, not thrown.
function typedCents(text: string) {
  try { return cents(text); } catch { return null; }
}

function editorForm(version: PricingVersion | null, unit: string) {
  return {
    version: version?.version ?? 0, previewEnabled: version?.previewEnabled ?? false,
    packageEnabled: version?.packageSize != null, packageLabel: version?.packageLabel ?? 'box',
    packageSize: version?.packageSize?.toString() ?? '',
    packagePrice: version?.packagePriceCents == null ? '' : (version.packagePriceCents / 100).toFixed(2),
    tiers: version?.bulkTiers.map((tier) => ({ minimum: String(tier.minimumQuantity), price: (tier.unitPriceCents / 100).toFixed(2) })) ?? [],
    verified: version?.baseUnit === unit,
  };
}

export function PricingEditor({ item }: { item: Item }) {
  const { accessToken } = useAuth();
  const { money } = useCompanySettings();
  const [form, setForm] = useState(() => editorForm(null, item.unit));
  const [savedConfiguration, setSavedConfiguration] = useState<PricingVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [quantityUnit, setQuantityUnit] = useState<'base' | 'package'>('base');
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  useEffect(() => {
    let active = true;
    if (accessToken) void api.pricingPreview(accessToken, item.id).then((result) => {
      if (!active) return;
      setSavedConfiguration(result.configuration); setForm(editorForm(result.configuration, item.unit)); setDirty(false); setQuote(null); setError(null);
    }).catch((caught: unknown) => {
      if (active) setError(safeErrorMessage(caught, 'Could not load prices.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, item.id, item.unit, revision]);
  const change = (next: typeof form) => { setForm(next); setDirty(true); setQuote(null); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || pending) return;
    setPending(true); setSaving(true); setError(null); setQuote(null);
    try {
      const prices = form.previewEnabled ? form : editorForm(savedConfiguration, item.unit);
      const saved = await api.savePricingPreview(accessToken, item.id, {
        expectedVersion: form.version, previewEnabled: form.previewEnabled, baseUnit: item.unit, baseUnitVerified: form.verified,
        package: prices.packageEnabled ? { label: prices.packageLabel, size: Number(prices.packageSize), priceCents: cents(prices.packagePrice) } : null,
        bulkTiers: prices.tiers.map((tier) => ({ minimumQuantity: Number(tier.minimum), unitPriceCents: cents(tier.price) })),
      });
      setSavedConfiguration(saved.configuration); setForm(editorForm(saved.configuration, item.unit)); setDirty(false); setQuantityUnit('base');
      toast.success('Pricing saved');
    } catch (caught) { setError(safeErrorMessage(caught, 'Could not save prices. Reload before retrying.')); }
    finally { setPending(false); setSaving(false); }
  };
  const preview = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || pending || dirty) return;
    setPending(true); setError(null); setQuote(null);
    try { setQuote(await api.quotePricingPreview(accessToken, [{ itemId: item.id, quantity: Number(quantity), quantityUnit, expectedVersion: form.version }])); }
    catch (caught) { setError(safeErrorMessage(caught, 'Could not calculate this quantity.')); }
    finally { setPending(false); }
  };
  if (loading) return <p role="status">Loading prices</p>;
  return <div className="pricing-editor">
    {error && <div className="form-error" role="alert">{error}<button className="button secondary" type="button" disabled={pending} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Reload prices</button></div>}
    <form onSubmit={(event) => void save(event)}><fieldset disabled={pending || item.sellingPriceCents == null}>
      <div className="pricing-current-price"><span>Individual price</span><strong>{item.sellingPriceCents == null ? 'Not set' : money(item.sellingPriceCents)} <small>per {item.unit}</small></strong></div>
      {item.sellingPriceCents == null && <p role="status">Set a price per {item.unit} above first.</p>}
      <label className="pricing-mode"><span>Pricing option</span><SelectControl aria-label="Pricing option" value={form.previewEnabled ? 'quantity' : 'individual'} onValueChange={(value) => { change({ ...form, previewEnabled: value === 'quantity' }); setQuantityUnit('base'); }} options={[{ value: 'individual', label: 'Individual price only' }, { value: 'quantity', label: 'Box and quantity discounts' }]} /></label>
      {form.previewEnabled && <>
        <div className="pricing-price-section">
          <label className="pricing-checkbox"><input type="checkbox" checked={form.packageEnabled} onChange={(event) => { change({ ...form, packageEnabled: event.target.checked }); setQuantityUnit('base'); }} />Offer a box or carton price</label>
          {form.packageEnabled && <div className="form-grid pricing-rule-grid">
            <label><span>Box or carton name</span><InputControl required maxLength={20} value={form.packageLabel} onValueChange={(packageLabel) => change({ ...form, packageLabel })} /><small className="pricing-hint">What your shop calls it, such as carton, crate, pack or dozen.</small></label>
            <label><span>{item.unit} per {form.packageLabel || 'box'}</span><InputControl required type="number" min="2" max="2147483647" step="1" value={form.packageSize} onValueChange={(packageSize) => change({ ...form, packageSize })} /><small className="pricing-hint">A whole number of {item.unit}. If you sell it in another size, add that size as its own item.</small></label>
            <label><span>Price for one box or carton</span><InputControl required type="number" min="0" max="21474836.47" step="0.01" value={form.packagePrice} onValueChange={(packagePrice) => change({ ...form, packagePrice })} /></label>
          </div>}
        </div>
        <div className="pricing-price-section">
          <h3>Quantity discounts</h3>
          <p>Each step gives a lower price per {item.unit} once a customer buys at least that many. The customer gets the one best step for the whole quantity, not a mix of steps. Each step must be a bigger quantity with a lower or equal price.{form.packageEnabled && ` Each full ${form.packageLabel || 'box'} is charged at the ${form.packageLabel || 'box'} price first, and steps apply to the loose ${item.unit} left over, so every step must be smaller than one ${form.packageLabel || 'box'}.`}</p>
          {form.tiers.map((tier, index) => <div className="form-grid pricing-rule-grid pricing-discount-row" key={index}>
            <label><span>Buy at least</span><InputControl aria-label={`Discount minimum ${index + 1}`} required type="number" min="1" max="2147483647" step="1" value={tier.minimum} onValueChange={(minimum) => change({ ...form, tiers: form.tiers.map((row, i) => i === index ? { ...row, minimum } : row) })} /></label>
            <label><span>Price per {item.unit}</span><InputControl aria-label={`Discount price ${index + 1}`} required type="number" min="0" max="21474836.47" step="0.01" value={tier.price} onValueChange={(price) => change({ ...form, tiers: form.tiers.map((row, i) => i === index ? { ...row, price } : row) })} /></label>
            <button className="button secondary" aria-label={`Remove discount ${index + 1}`} type="button" onClick={() => change({ ...form, tiers: form.tiers.filter((_, i) => i !== index) })}>Remove</button>
          </div>)}
          <button className="button secondary" type="button" disabled={form.tiers.length >= 100} onClick={() => change({ ...form, tiers: [...form.tiers, { minimum: '', price: '' }] })}>Add quantity discount</button>
        </div>
        {item.sellingPriceCents != null && <DealSummary form={form} unit={item.unit} retailCents={item.sellingPriceCents} money={money} />}
      </>}
      {savedConfiguration?.baseUnit !== item.unit && <div className="pricing-unit-confirmation">
        <label className="pricing-checkbox"><input type="checkbox" required checked={form.verified} onChange={(event) => setForm({ ...form, verified: event.target.checked })} />My stock is counted in {item.unit}.</label>
        <p>Box sizes use this unit. Existing stock quantities stay the same.</p>
      </div>}
      <button className="button" disabled={!form.verified} type="submit">{saving ? 'Saving' : 'Save pricing'}</button>
    </fieldset></form>
    <section className="pricing-calculator" aria-label="Try a quantity">
      <h3>Try a quantity</h3>
      <form className="form-grid pricing-quote-form" onSubmit={(event) => void preview(event)}>
        <label><span>Quantity</span><InputControl aria-label="Test quantity" required type="number" min="1" max="2147483647" step="1" disabled={pending || dirty || item.sellingPriceCents == null} value={quantity} onValueChange={(value) => { setQuantity(value); setQuote(null); }} /></label>
        <label><span>Counted in</span><SelectControl aria-label="Test quantity unit" disabled={pending || dirty || item.sellingPriceCents == null} value={quantityUnit} onValueChange={(value) => { setQuantityUnit(value as typeof quantityUnit); setQuote(null); }} options={[{ value: 'base', label: item.unit }, ...(form.previewEnabled && form.packageEnabled ? [{ value: 'package', label: form.packageLabel }] : [])]} /></label>
        <button className="button secondary" disabled={pending || dirty || item.sellingPriceCents == null} type="submit">{pending && !saving ? 'Calculating' : 'Calculate total'}</button>
        {dirty && <p role="status">Save pricing to try these changes.</p>}
      </form>
    </section>
    {quote && <div className="pricing-quote-result" role="status">
      <p>{quote.lines[0].quantity} {item.unit} · Total <strong>{money(quote.totalCents)}</strong></p>
      {quote.lines[0].priceDropQuantities.length > 0 && <p>Adding a unit reduces the total at these quantities: {quote.lines[0].priceDropQuantities.join(', ')} {item.unit}. Review these boundaries before using this pricing.</p>}
      <div className="table-wrap"><table><thead><tr><th>Pricing</th><th className="num">Quantity</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead><tbody>{quote.lines[0].components.map((part, index) => <tr key={index}><td>{({ retail: 'Individual', bulk: 'Quantity discount', box: 'Box / carton' })[part.category]}</td><td className="num">{part.quantity}</td><td className="num">{money(part.unitPriceCents)}</td><td className="num">{money(part.totalCents)}</td></tr>)}</tbody></table></div>
      <p>At individual price {money(quote.grossSalesCents)} · You save {money(quote.automaticDiscountCents)}</p>
    </div>}
  </div>;
}

type EditorForm = ReturnType<typeof editorForm>;

/** The item's deal in plain words, from the form as the owner types it. */
function DealSummary({ form, unit, retailCents, money }: { form: EditorForm; unit: string; retailCents: number; money: (cents: number) => string }) {
  const size = form.packageEnabled ? Number(form.packageSize) : null;
  const steps = form.tiers
    .flatMap((tier) => { const price = typedCents(tier.price); return price == null ? [] : [{ minimum: Number(tier.minimum), cents: price }]; })
    .filter((step) => Number.isInteger(step.minimum) && step.minimum > 1)
    .sort((left, right) => left.minimum - right.minimum);
  const looseLimit = size && Number.isInteger(size) && size > 1 ? size - 1 : null;
  const range = (from: number, to: number | null) => to === null ? `${from} or more` : from === to ? `${from}` : `${from}–${to}`;
  const rows = [{ minimum: 1, cents: retailCents }, ...steps].map((step, index, all) => {
    const next = all[index + 1];
    const to = next ? next.minimum - 1 : looseLimit;
    return { label: `Buy ${range(step.minimum, to)}`, price: `${money(step.cents)} per ${unit}` };
  });
  const packageCents = form.packageEnabled ? typedCents(form.packagePrice) : null;
  return <div className="pricing-summary" aria-label="This deal in plain words">
    <h3>What customers pay</h3>
    <ul>
      {rows.map((row) => <li key={row.label}><span>{row.label}</span><b>{row.price}</b></li>)}
      {looseLimit && packageCents != null && <li><span>Every full {form.packageLabel || 'box'} of {size}</span><b>{money(packageCents)} ({money(Math.round(packageCents / size!))} per {unit})</b></li>}
    </ul>
    {looseLimit && <p>A customer buying more than one {form.packageLabel || 'box'} pays the {form.packageLabel || 'box'} price for each full one, then the prices above for what is left.</p>}
  </div>;
}
