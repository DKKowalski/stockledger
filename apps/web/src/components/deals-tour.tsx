import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { useCompanySettings } from '../app/company-settings-store';
import { TallyMascot } from './tally-mascot';
import { markSeen, readSeen, storageKey, TourContext, useDealsTour } from './deals-tour-context';

// A short in-app walkthrough of box and quantity deals. Each stop opens a real screen and
// highlights the element marked with the matching data-tour attribute.
type Stop = { route?: string; target?: string; title: string; body: string; receipt?: boolean };

const stops: readonly Stop[] = [
  { route: '/settings/inventory', target: 'deals-switch', title: 'Turn deals on', body: 'Deals are off until you turn them on here. You can turn them off again at any time.' },
  { route: '/items?tab=pricing', target: 'item-pricing', title: 'Add a deal to an item', body: 'Open an item and choose Pricing. Name the box (carton, crate, pack), say how many are in it, and set its price. You can also add lower prices for bigger quantities. "What customers pay" shows the result.' },
  { title: 'Selling stays simple', body: 'Your shop attendant only picks the item and the quantity. StockLedger uses the best price and shows the discount on the screen:', receipt: true },
  { route: '/profitability', target: 'profit-discounts', title: 'See your discounts', body: 'Profit shows how much discount you gave. The sales and profit there are already after discounts.' },
];

export function DealsTourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const key = user ? storageKey(user.id, 'deals') : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const seen = !key || dismissedKey === key || readSeen(key);

  const dismiss = () => {
    if (key) markSeen(key);
    setDismissedKey(key);
    setIndex(null);
  };
  const go = (next: number) => {
    const stop = stops[next];
    if (stop?.route) navigate(stop.route);
    setIndex(next);
  };
  const value = { start: () => go(0), dismiss, seen };

  return <TourContext.Provider value={value}>
    {children}
    {index !== null && <TourStop index={index} onBack={() => go(index - 1)} onNext={() => (index === stops.length - 1 ? dismiss() : go(index + 1))} onClose={dismiss} />}
  </TourContext.Provider>;
}

function TourStop({ index, onBack, onNext, onClose }: { index: number; onBack: () => void; onNext: () => void; onClose: () => void }) {
  const stop = stops[index]!;
  const { money } = useCompanySettings();
  const last = index === stops.length - 1;
  const [onLeft, setOnLeft] = useState(false);

  // Pages load their data after navigation, so keep looking for the target briefly.
  useEffect(() => {
    if (!stop.target) return;
    let element: Element | null = null;
    let frame = 0;
    const started = performance.now();
    const find = () => {
      element = document.querySelector(`[data-tour="${stop.target}"]`);
      if (element) {
        element.classList.add('tour-highlight');
        // Keep the card clear of a highlight on the right side of the screen.
        setOnLeft(element.getBoundingClientRect().right > window.innerWidth - 440);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (performance.now() - started < 4000) frame = requestAnimationFrame(find);
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
      element?.classList.remove('tour-highlight');
    };
  }, [stop.target, index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <aside className={`tour-card ${onLeft ? 'is-left' : ''}`} role="dialog" aria-modal="false" aria-labelledby="tour-title">
    <div className="tour-card-top">
      <span className="tour-step">Step {index + 1} of {stops.length}</span>
      <button className="icon-button" aria-label="Close the guide" onClick={onClose} type="button"><X size={16} /></button>
    </div>
    <h2 id="tour-title">{stop.title}</h2>
    <p>{stop.body}</p>
    {stop.receipt && <dl className="checkout-totals tour-receipt">
      <div><dt>Price before discount</dt><dd>{money(7500)}</dd></div>
      <div className="checkout-discount"><dt>Discount</dt><dd>− {money(660)}</dd></div>
      <div className="checkout-pay"><dt>Customer pays</dt><dd>{money(6840)}</dd></div>
    </dl>}
    <div className="tour-progress" aria-hidden="true">{stops.map((_, dot) => <i key={dot} className={dot <= index ? 'is-done' : ''} />)}</div>
    <div className="tour-actions">
      {index > 0 && <button className="button secondary" onClick={onBack} type="button"><ArrowLeft size={15} />Back</button>}
      <button className="button" onClick={onNext} type="button">{last ? <>Done<Check size={15} /></> : <>Next<ArrowRight size={15} /></>}</button>
    </div>
  </aside>;
}

export function DealsWhatsNew() {
  const { start, dismiss, seen } = useDealsTour();
  if (seen) return null;
  return <section className="whats-new" aria-labelledby="whats-new-title">
    <div>
      <span className="whats-new-kicker">New</span>
      <h2 id="whats-new-title">Box and quantity deals</h2>
      <p>Sell a full box for less, or give a lower price when a customer buys more. It takes about a minute to see how.</p>
      <div className="whats-new-actions">
        <button className="button" onClick={start} type="button">Show me<ArrowRight size={15} /></button>
        <button className="button secondary" onClick={dismiss} type="button">Not now</button>
      </div>
    </div>
    <div className="whats-new-tally"><TallyMascot compact tip="Four short steps. Nothing changes until you turn deals on." /></div>
  </section>;
}

// Attendants only need to know what changes on the Sell screen.
export function DealsAttendantNotice() {
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const key = user ? storageKey(user.id, 'deals-attendant') : null;
  const [seen, setSeen] = useState(() => (key ? readSeen(key) : true));
  if (seen || !settings?.hybridPricingEnabled) return null;
  const close = () => { if (key) markSeen(key); setSeen(true); };
  return <section className="whats-new is-short" aria-labelledby="attendant-deals-title">
    <div>
      <span className="whats-new-kicker">New</span>
      <h2 id="attendant-deals-title">Deals are on</h2>
      <p>When a customer buys a full box or a bigger quantity, the lower price is used for you. The Sell screen shows the discount before you complete the sale.</p>
      <div className="whats-new-actions">
        <NavLink className="button" onClick={close} to="/sell">Go to Sell<ArrowRight size={15} /></NavLink>
        <button className="button secondary" onClick={close} type="button">Got it</button>
      </div>
    </div>
  </section>;
}
