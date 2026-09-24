import { ArrowLeft, ArrowRight, Building2, Check, PackageOpen, ScrollText, Store, Warehouse } from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { SpreadsheetImportIcon } from '../../components/animated-icons';
import { StockLedgerMark } from '../../components/stockledger-mark';
import { TallyMascot } from '../../components/tally-mascot';
import { InputControl } from '../../components/ui/input-control';
import type { BusinessType, InventorySource, LocationType, OnboardingStatus } from '../../types';

type OnboardingPageProps = {
  initialStatus: OnboardingStatus;
  onComplete: (status: OnboardingStatus) => void;
};

const businessOptions: Array<{ value: BusinessType; title: string; description: string }> = [
  { value: 'retail', title: 'Retail shop', description: 'I sell directly to customers.' },
  { value: 'wholesale', title: 'Wholesale', description: 'I sell stock in larger quantities.' },
  { value: 'warehouse', title: 'Warehouse or distribution', description: 'I receive, store and move inventory.' },
  { value: 'mixed', title: 'A mix of these', description: 'My business works across more than one model.' },
];

const sourceOptions = [
  { value: 'spreadsheet', title: 'A spreadsheet', description: 'My stock is in Excel, Sheets or a CSV.', icon: SpreadsheetImportIcon },
  { value: 'another_system', title: 'Another system', description: 'I am moving from other inventory software.', icon: Building2 },
  { value: 'paper', title: 'Paper records', description: 'My counts live in notebooks or printed sheets.', icon: ScrollText },
  { value: 'starting_fresh', title: 'Starting fresh', description: 'I will create my first items here.', icon: PackageOpen },
] satisfies Array<{ value: InventorySource; title: string; description: string; icon: ComponentType<{ className?: string; size?: number }> }>;

export function OnboardingPage({ initialStatus, onComplete }: OnboardingPageProps) {
  const { accessToken, signOut } = useAuth();
  const firstStep = initialStatus.company.businessType ? (initialStatus.counts.locations ? 2 : 1) : 0;
  const [step, setStep] = useState<0 | 1 | 2 | 3>(initialStatus.company.inventorySource && initialStatus.counts.locations ? 2 : firstStep);
  const [businessType, setBusinessType] = useState<BusinessType | null>(initialStatus.company.businessType);
  const [locationType, setLocationType] = useState<LocationType>('shop');
  const [locationName, setLocationName] = useState('');
  const [locationReady, setLocationReady] = useState(initialStatus.counts.locations > 0);
  const [inventorySource, setInventorySource] = useState<InventorySource | null>(initialStatus.company.inventorySource);
  const [completedStatus, setCompletedStatus] = useState<OnboardingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepCopy = useMemo(() => [
    { eyebrow: 'Your business', title: 'What kind of business do you run?', description: 'We will use this to put the most useful setup tasks first.' },
    { eyebrow: 'Your first place', title: 'Where do you keep stock?', description: 'Every quantity in StockLedger belongs to a shop or warehouse.' },
    { eyebrow: 'Your inventory', title: 'Where are your stock records today?', description: 'This changes what we recommend when you enter the workspace.' },
    { eyebrow: 'Setup complete', title: 'Your ledger is live.', description: `Your first place is ready inside ${initialStatus.company.name}.` },
  ][step], [initialStatus.company.name, step]);

  if (!accessToken) return null;

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      if (step === 0 && businessType) {
        await api.setBusinessType(accessToken, businessType);
        setStep(locationReady ? 2 : 1);
      } else if (step === 1 && locationName.trim()) {
        await api.addLocation(accessToken, { name: locationName.trim(), type: locationType });
        setLocationReady(true);
        setStep(2);
      } else if (step === 2 && inventorySource) {
        await api.setInventorySource(accessToken, inventorySource);
        const completed = await api.completeOnboarding(accessToken);
        setCompletedStatus(completed);
        setStep(3);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this step');
    } finally {
      setBusy(false);
    }
  };

  const canContinue = step === 0 ? Boolean(businessType) : step === 1 ? Boolean(locationName.trim()) : step === 2 ? Boolean(inventorySource) : true;

  return <main className="onboarding-page">
    <header className="onboarding-header">
      <div className="brand"><span className="brand-mark"><StockLedgerMark /></span>StockLedger</div>
      <button className="onboarding-exit" onClick={signOut} type="button">Save and exit</button>
    </header>
    <div className="onboarding-progress" aria-label={`Setup step ${Math.min(step + 1, 3)} of 3`}>
      {[0, 1, 2].map((part) => <span className={part <= step ? 'active' : ''} key={part} />)}
    </div>
    <div className="onboarding-layout">
      <section className="onboarding-form-card">
        <div className="onboarding-copy" key={step}>
          <span className="onboarding-eyebrow">{stepCopy.eyebrow}{step < 3 && <small>{step + 1} of 3</small>}</span>
          <h1>{stepCopy.title}</h1>
          <p>{stepCopy.description}</p>
        </div>

        {error && <div className="login-error onboarding-error" role="alert">{error}</div>}

        {step === 0 && <div className="onboarding-options" role="radiogroup" aria-label="Business type">
          {businessOptions.map((option) => <button aria-checked={businessType === option.value} className={`onboarding-option ${businessType === option.value ? 'selected' : ''}`} key={option.value} onClick={() => setBusinessType(option.value)} role="radio" type="button">
            <span className="option-check">{businessType === option.value && <Check size={13} />}</span>
            <span><b>{option.title}</b><small>{option.description}</small></span>
          </button>)}
        </div>}

        {step === 1 && <div className="location-step">
          <div className="location-type-options" role="radiogroup" aria-label="Location type">
            <button aria-checked={locationType === 'shop'} className={`location-type-option ${locationType === 'shop' ? 'selected' : ''}`} onClick={() => setLocationType('shop')} role="radio" type="button"><Store size={23} /><span><b>Shop</b><small>Stock customers can buy here</small></span></button>
            <button aria-checked={locationType === 'warehouse'} className={`location-type-option ${locationType === 'warehouse' ? 'selected' : ''}`} onClick={() => setLocationType('warehouse')} role="radio" type="button"><Warehouse size={23} /><span><b>Warehouse</b><small>Stock is received and stored here</small></span></button>
          </div>
          <label className="onboarding-location-name"><span>{locationType === 'shop' ? 'Shop name' : 'Warehouse name'}</span><InputControl autoFocus placeholder={locationType === 'shop' ? 'Main shop' : 'Main warehouse'} required value={locationName} onValueChange={setLocationName} /></label>
        </div>}

        {step === 2 && <div className="onboarding-options source-options" role="radiogroup" aria-label="Current inventory source">
          {sourceOptions.map(({ value, title, description, icon: Icon }) => <button aria-checked={inventorySource === value} className={`onboarding-option source-option ${inventorySource === value ? 'selected' : ''}`} data-source={value} key={value} onClick={() => setInventorySource(value)} role="radio" type="button">
            <Icon className="source-motion-icon" size={19} /><span><b>{title}</b><small>{description}</small></span><span className="option-check">{inventorySource === value && <Check size={13} />}</span>
          </button>)}
        </div>}

        {step === 3 && <div className="onboarding-complete-list">
          <span><Check size={15} />Business profile saved</span>
          <span><Check size={15} />First stock location created</span>
          <span><Check size={15} />Launch path personalized</span>
        </div>}

        <div className="onboarding-actions">
          {step > 0 && step < 3 && <button className="onboarding-back" disabled={busy} onClick={() => setStep(step === 2 && locationReady ? 0 : (step - 1) as 0 | 1 | 2)} type="button"><ArrowLeft size={15} />Back</button>}
          {step < 3 ? <button className="button onboarding-continue" disabled={!canContinue || busy} onClick={() => void next()} type="button">{busy ? <><StockLedgerMark animated size={18} />Saving</> : <>{step === 2 ? 'Finish setup' : 'Continue'}<ArrowRight size={16} /></>}</button> : <button className="button onboarding-continue" onClick={() => onComplete(completedStatus ?? { ...initialStatus, completed: true })} type="button">Open my workspace<ArrowRight size={16} /></button>}
        </div>
      </section>
      <aside className="onboarding-tally-panel">
        <div className="tally-stage-copy"><span>{step === 3 ? 'All set' : 'Your setup guide'}</span><p>{step === 3 ? 'Tally will stay nearby while you finish the first few tasks.' : 'Tally only speaks when you ask.'}</p></div>
        <TallyMascot celebrating={step === 3} step={step} />
        <div className="tally-ledger-lines" aria-hidden="true"><span /><span /><span /><span /></div>
      </aside>
    </div>
  </main>;
}
