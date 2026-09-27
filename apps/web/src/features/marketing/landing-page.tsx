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
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { StockLedgerMark } from '../../components/stockledger-mark';

gsap.registerPlugin(ScrollTrigger, SplitText);

const workflowDetails = [
  {
    icon: PackagePlus,
    step: 'Receive',
    copy: 'Add delivered stock to the warehouse or shop where it arrived.',
    tone: 'olive',
  },
  {
    icon: ArrowLeftRight,
    step: 'Move',
    copy: 'Move units between places while both sides of the ledger stay connected.',
    tone: 'sand',
  },
  {
    icon: BadgeDollarSign,
    step: 'Sell',
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
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingTextReveals(pageRef);
  useLandingScrollReveals(pageRef);

  return <div className="landing-page" ref={pageRef}>
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
          <RevealHeading as="h1" first="Every item," second="accounted for." hero />
          <p className="landing-lede">StockLedger keeps your warehouses, shops, movements, and selling prices in one shared record your team can trust.</p>
          <div className="landing-hero-actions">
            <Link className="landing-button" to="/signup">Create your workspace<ArrowUpRight size={17} /></Link>
            <a className="landing-text-link" href="#product">See the product<ArrowRight size={15} /></a>
          </div>
          <p className="landing-hero-note"><Check size={14} />Start with a spreadsheet or a clean catalog.</p>
        </div>

        <div className="landing-proof" aria-label="StockLedger capabilities">
          <span><Warehouse size={16} />Warehouses</span>
          <span><Store size={16} />Shops</span>
          <span><MapPin size={16} />Every place</span>
          <span><UsersRound size={16} />The whole team</span>
        </div>

        <ProductFrame
          className="landing-hero-product"
          image="/product/stockledger-dashboard.jpg"
          alt="StockLedger inventory overview showing stock totals, movement charts, and inventory health"
          priority
        />
      </section>

      <section className="landing-section landing-flow-section" id="workflow">
        <div className="landing-flow-heading">
          <div><RevealHeading as="h2" first="A straight line between stock arriving" second="and stock being sold." /></div>
          <p>No separate books, mystery adjustments, or balances that only one person understands. Every action updates the right place and leaves a record behind.</p>
        </div>
        <div className="landing-flow-grid">
          {workflowDetails.map(({ icon: Icon, step, copy, tone }, index) => <article className={`landing-flow-card is-${tone}`} data-reveal key={step}>
            <div className="landing-flow-card-top">
              <span className="landing-flow-number" aria-hidden="true">0{index + 1}</span>
              <span className="landing-flow-icon" aria-hidden="true"><Icon size={22} /></span>
            </div>
            <div className="landing-flow-card-copy">
              <h3>{step}</h3>
              <p>{copy}</p>
            </div>
          </article>)}
        </div>
      </section>

      <section className="landing-section landing-product-story" id="product">
        <div className="landing-section-heading">
          <RevealHeading as="h2" first="One ledger." second="Every movement, place, and reason." />
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
          <div className="landing-import-copy">
            <span className="landing-import-icon"><FileSpreadsheet size={24} /></span>
            <RevealHeading as="h2" first="Bring the stock list" second="you already have." />
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
        <div className="landing-section-heading landing-roles-heading">
          <RevealHeading as="h2" first="Clear access." second="No crossed wires." />
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

      <section className="landing-cta">
        <div>
          <RevealHeading as="h2" first="Know what remains" second="before the day ends." />
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
  return <figure className={['landing-product-frame', dark ? 'is-dark' : '', className].filter(Boolean).join(' ')} data-reveal={reveal ? 'product' : undefined} data-scroll-motion="">
    <div className="landing-browser-bar" aria-hidden="true">
      <span className="landing-browser-address"><StockLedgerMark size={13} />Live workspace</span>
      <span className="landing-browser-context">Updated by every movement</span>
    </div>
    <img src={image} alt={alt} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} />
  </figure>;
}

function RevealHeading({ as: Heading, first, second, hero = false }: {
  as: 'h1' | 'h2';
  first: string;
  second: string;
  hero?: boolean;
}) {
  return <Heading data-text-reveal={hero ? 'hero' : 'section'}>{first}<br /><em>{second}</em></Heading>;
}

function useLandingTextReveals(pageRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const context = gsap.context(() => {
      const heroHeading = page.querySelector<HTMLElement>('[data-text-reveal="hero"]');
      if (heroHeading) {
        const supportingCopy = page.querySelectorAll<HTMLElement>('.landing-lede, .landing-hero-actions, .landing-hero-note');
        SplitText.create(heroHeading, {
          type: 'lines',
          mask: 'lines',
          linesClass: 'landing-reveal-line',
          autoSplit: true,
          onSplit: (split) => gsap.timeline({ delay: 0.08 })
            .from(split.lines, {
              yPercent: 102,
              duration: 0.78,
              stagger: 0.075,
              ease: 'power3.out',
            })
            .from(supportingCopy, {
              autoAlpha: 0,
              y: 8,
              duration: 0.45,
              stagger: 0.045,
              ease: 'power2.out',
            }, '>-0.1'),
        });
      }

      page.querySelectorAll<HTMLElement>('[data-text-reveal="section"]').forEach((heading) => {
        SplitText.create(heading, {
          type: 'lines',
          mask: 'lines',
          linesClass: 'landing-reveal-line',
          autoSplit: true,
          onSplit: (split) => gsap.from(split.lines, {
            yPercent: 102,
            duration: 0.72,
            stagger: 0.065,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: heading,
              start: 'top 78%',
              once: true,
            },
          }),
        });
      });
    }, page);

    return () => context.revert();
  }, [pageRef]);
}

function useLandingScrollReveals(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const elements = Array.from(page.querySelectorAll<HTMLElement>('[data-reveal]'));
    const motionFrames = Array.from(page.querySelectorAll<HTMLElement>('[data-scroll-motion]'));
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
    let frame = 0;
    const updateMotion = () => {
      const viewportHeight = window.innerHeight;
      motionFrames.forEach((element) => {
        const bounds = element.getBoundingClientRect();
        const progress = Math.max(0, Math.min(1, (viewportHeight - bounds.top) / (viewportHeight + bounds.height)));
        element.style.setProperty('--landing-parallax', `${(progress - .5) * -18}px`);
      });
      frame = 0;
    };
    const requestMotionUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateMotion);
    };

    updateMotion();
    window.addEventListener('scroll', requestMotionUpdate, { passive: true });
    window.addEventListener('resize', requestMotionUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', requestMotionUpdate);
      window.removeEventListener('resize', requestMotionUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pageRef]);
}
