import { ArrowUpRight, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInventoryStore } from '../../app/inventory-store';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { TallyMascot } from '../../components/tally-mascot';
import type { OnboardingStatus } from '../../types';

export function OwnerSetupChecklist() {
  const { accessToken, user } = useAuth();
  const { snapshot } = useInventoryStore();
  const [mascotDismissed, setMascotDismissed] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    if (!accessToken || user?.role !== 'administrator') return;
    let cancelled = false;
    void api.onboardingStatus(accessToken).then((next) => {
      if (!cancelled) setStatus(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [accessToken, user?.role]);

  const tasks = useMemo(() => status ? [
    status.completed,
    status.counts.locations > 0,
    status.counts.items > 0,
    status.counts.movements > 0 || Boolean(snapshot?.positions.some(position => position.closing > 0 || position.opening > 0)),
    Boolean(snapshot?.items.some(item => item.isActive && item.sellingPriceCents != null && item.sellingPriceCents > 0)),
    status.counts.teammates > 0,
  ] : [], [status, snapshot]);

  if (!status || user?.role !== 'administrator') return null;
  const itemTaskLabel = {
    spreadsheet: 'Import your spreadsheet',
    another_system: 'Recreate your first catalog item',
    paper: 'Move your first paper record',
    starting_fresh: 'Create your first inventory item',
  }[status.company.inventorySource ?? 'starting_fresh'];
  const taskDefinitions = [
    { key: 'profile', label: 'Business profile ready', path: '/account' },
    { key: 'location', label: 'Name your first stock location', path: '/places' },
    { key: 'item', label: itemTaskLabel, path: status.company.inventorySource === 'spreadsheet' ? '/items?import=1' : '/items' },
    { key: 'movement', label: 'Receive your first stock', path: '/movements' },
    { key: 'price', label: 'Set a selling price', path: '/items?tab=pricing' },
    { key: 'teammate', label: 'Invite a teammate (optional)', path: '/team' },
  ] as const;
  const completed = tasks.filter(Boolean).length;
  if (completed === taskDefinitions.length) return null;
  const nextTaskIndex = tasks.findIndex((task) => !task);
  const nextTask = taskDefinitions[nextTaskIndex];
  const percent = Math.round((completed / taskDefinitions.length) * 100);

  return <section className="owner-setup-card" aria-labelledby="owner-setup-title">
    <div className="owner-setup-summary">
      <div className="owner-setup-kicker"><span>Workspace setup</span><b>{percent}% ready</b></div>
      <h2 id="owner-setup-title">Open your ledger</h2>
      <p>Next: {nextTask.label}. {nextTask.key === 'movement' ? 'Record the units on your shelf so your team can see what is available.' : nextTask.key === 'price' ? 'Give your team a price to use at checkout.' : 'Each step uses real workspace activity.'}</p>
      <div className="owner-setup-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${percent}% of workspace setup complete`}><i style={{ transform: `scaleX(${percent / 100})` }} /></div>
      <Link className="button owner-setup-next" to={nextTask.path}>{nextTask.label}<ArrowUpRight size={16} /></Link>
    </div>
    <div className="owner-setup-tasks">
      {taskDefinitions.map((task, index) => <Link className={`${tasks[index] ? 'complete' : ''} ${index === nextTaskIndex ? 'next' : ''}`} key={task.key} to={task.path}>
        <span>{tasks[index] ? <Check size={13} /> : index + 1}</span>
        <b>{task.label}</b>
      </Link>)}
    </div>
    <div className="owner-setup-tally">{completed > 2 && !mascotDismissed && <><TallyMascot compact step={3} /><button type="button" className="text-button" onClick={() => setMascotDismissed(true)}>Dismiss mascot</button></>}</div>
  </section>;
}
