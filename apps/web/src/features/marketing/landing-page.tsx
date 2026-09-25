import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  Check,
  FileSpreadsheet,
  MapPin,
  PackageCheck,
  PackagePlus,
  ShieldCheck,
  ShoppingBag,
  Store,
  UsersRound,
  Warehouse,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { StockLedgerMark } from '../../components/stockledger-mark';

const workflowDetails = [
  {
    icon: PackagePlus,
    step: 'Receive',
    label: 'Purchase recorded',
    copy: 'Add delivered stock to the warehouse or shop where it arrived.',
    tone: 'olive',
  },
  {
    icon: ArrowLeftRight,
    step: 'Move',
    label: 'Balances transferred',
    copy: 'Move units between places while both sides of the ledger stay connected.',
    tone: 'sand',
  },
  {
    icon: BadgeDollarSign,
    step: 'Sell',
    label: 'Price captured',
    copy: 'Reduce shop stock and preserve the selling price used for that transaction.',
    tone: 'clay',
  },
] as const;

const roleDetails = [
  {
    icon: ShieldCheck,
    name: 'Business owner',
    copy: 'See the whole operation, set selling prices, manage places, and control team access.',
  },
  {
    icon: PackageCheck,
    name: 'Inventory manager',
    copy: 'Receive stock, transfer it between places, record damage, and keep the ledger accurate.',
  },
  {
    icon: ShoppingBag,
    name: 'Shop attendant',
    copy: 'Sell from the assigned shop and check what is available without reaching admin controls.',
  },
] as const;

export function LandingPage() {
  useLandingScrollReveals();

  return <div className="landing-page">
    <header className="landing-nav">
      <div className="landing-nav-inner">
        <Link className="landing-brand" to="/" aria-label="StockLedger home">
          <span className="brand-mark"><StockLedgerMark size={25} /></span>
          <span>StockLedger</span>
        </Link>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#workflow">How it works</a>
          <a href="#product">Product</a>
          <a href="#roles">For your team</a>
        </nav>
        <div className="landing-nav-actions">
          <Link className="landing-sign-in" to="/login">Sign in</Link>
          <Link className="landing-button landing-button-small" to="/signup">Create workspace<ArrowUpRight size={15} /></Link>
        </div>
      </div>
    </header>

    <main>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><span />Inventory control for growing teams</p>
          <h1>Know what came in.<br />What went out.<br /><em>What remains.</em></h1>
          <p className="landing-lede">StockLedger keeps your warehouses, shops, movements, and selling prices in one shared record your team can trust.</p>
          <div className="landing-hero-actions">
            <Link className="landing-button" to="/signup">Create your workspace<ArrowUpRight size={17} /></Link>
            <a className="landing-text-link" href="#product">See the product<ArrowRight size={15} /></a>
          </div>
          <p className="landing-hero-note"><Check size={14} />Start with a spreadsheet or a clean catalog.</p>
        </div>

        <ProductFrame
          className="landing-hero-product"
          image="/product/stockledger-dashboard.jpg"
          alt="StockLedger inventory overview showing stock totals, movement charts, and inventory health"
          priority
        />
      </section>

      <section className="landing-proof" aria-label="StockLedger capabilities" data-reveal>
        <span><Warehouse size={17} />Warehouse stock</span>
        <span><Store size={17} />Shop inventory</span>
        <span><MapPin size={17} />Per-place balances</span>
        <span><UsersRound size={17} />Role-based access</span>
      </section>

      <section className="landing-section landing-flow-section" id="workflow">
        <div className="landing-flow-heading" data-reveal>
          <div><p className="landing-kicker">A clear operating line</p><h2>From delivery to shelf, every change has a place.</h2></div>
          <p>StockLedger follows the work your team already does. Each action updates the right balance and leaves a record behind.</p>
        </div>
        <div className="landing-flow-grid">
          {workflowDetails.map(({ icon: Icon, step, label, copy, tone }) => <article className={`landing-flow-card is-${tone}`} data-reveal key={step}>
            <div className="landing-flow-visual" aria-hidden="true">
              <span className="landing-flow-icon"><Icon size={20} /></span>
              <span className="landing-flow-path"><i /></span>
              <span className="landing-flow-check"><Check size={14} /></span>
            </div>
            <p>{label}</p>
            <h3>{step}</h3>
            <span>{copy}</span>
          </article>)}
        </div>
      </section>

      <section className="landing-section landing-product-story" id="product">
        <div className="landing-section-heading" data-reveal>
          <p className="landing-kicker">One source of truth</p>
          <h2>See every movement without chasing a spreadsheet.</h2>
        </div>
        <div className="landing-product-grid">
          <div className="landing-product-copy" data-reveal>
            <p>Purchases, transfers, returns, damage, and sales update the right balance as soon as your team records them.</p>
            <div className="landing-detail-list">
              <div><span>01</span><p><b>A ledger you can follow</b><small>Each entry keeps its date, place, quantity, and reference together.</small></p></div>
              <div><span>02</span><p><b>Prices stay accountable</b><small>The sale records the price used that day, even when the current price changes later.</small></p></div>
              <div><span>03</span><p><b>Problems stand out</b><small>Low stock, damage, and dead stock appear where the owner can act on them.</small></p></div>
            </div>
          </div>
          <ProductFrame
            className="landing-movement-product"
            image="/product/stockledger-movements.jpg"
            alt="StockLedger stock movement form and movement ledger"
            reveal
          />
        </div>
      </section>

      <section className="landing-import-section">
        <div className="landing-import-inner">
          <div className="landing-import-copy" data-reveal>
            <span className="landing-import-icon"><FileSpreadsheet size={24} /></span>
            <p className="landing-kicker">A quicker first day</p>
            <h2>Bring your spreadsheet. Leave it behind.</h2>
            <p>Upload Excel or CSV, choose the opening place, and review each row before it becomes stock. You can also build the catalog by hand.</p>
            <Link className="landing-dark-link" to="/signup">Set up your inventory<ArrowUpRight size={16} /></Link>
          </div>
          <ProductFrame
            className="landing-import-product"
            image="/product/stockledger-import.jpg"
            alt="StockLedger spreadsheet inventory import and item setup"
            reveal
          />
        </div>
      </section>

      <section className="landing-section landing-roles" id="roles">
        <div className="landing-section-heading landing-roles-heading" data-reveal>
          <p className="landing-kicker">Clear responsibilities</p>
          <h2>Every person sees the work they are meant to do.</h2>
          <p>Owners keep control. The team gets focused screens for daily stock work and sales.</p>
        </div>
        <div className="landing-role-grid">
          {roleDetails.map(({ icon: Icon, name, copy }, index) => <article data-reveal key={name}>
            <div className="landing-role-top"><span>0{index + 1}</span><span className="landing-role-icon"><Icon size={20} /></span></div>
            <h3>{name}</h3>
            <p>{copy}</p>
          </article>)}
        </div>
      </section>

      <section className="landing-cta" data-reveal>
        <div>
          <p className="landing-kicker">Your first ledger starts here</p>
          <h2>Start with the stock you have today.</h2>
        </div>
        <div className="landing-cta-actions">
          <Link className="landing-button landing-button-light" to="/signup">Create your workspace<ArrowUpRight size={17} /></Link>
          <Link className="landing-cta-sign-in" to="/login">I already have an account</Link>
        </div>
      </section>
    </main>

    <footer className="landing-footer">
      <div className="landing-brand"><span className="brand-mark"><StockLedgerMark size={23} /></span><span>StockLedger</span></div>
      <p>Stock certainty for teams that move inventory.</p>
      <nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav>
    </footer>
  </div>;
}

function ProductFrame({ image, alt, className, priority = false, dark = false, reveal = false }: {
  image: string;
  alt: string;
  className?: string;
  priority?: boolean;
  dark?: boolean;
  reveal?: boolean;
}) {
  return <figure className={['landing-product-frame', dark ? 'is-dark' : '', className].filter(Boolean).join(' ')} data-reveal={reveal ? '' : undefined}>
    <div className="landing-browser-bar" aria-hidden="true">
      <span className="landing-browser-dots"><i /><i /><i /></span>
      <span className="landing-browser-address"><StockLedgerMark size={13} />stockledger.app</span>
      <span className="landing-browser-spacer" />
    </div>
    <img src={image} alt={alt} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} />
  </figure>;
}

function useLandingScrollReveals() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    elements.forEach((element) => element.classList.add('reveal-ready'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
}
