import { ArrowUpRight, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth-context';
import { TallyMascot } from '../../components/tally-mascot';
import type { OnboardingStatus } from '../../types';

export function OwnerSetupChecklist() {
  const { accessToken, user } = useAuth();
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
    status.counts.movements > 0,
    status.counts.teammates > 0,
  ] : [], [status]);

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
    { key: 'movement', label: 'Record your first stock movement', path: '/movements' },
    { key: 'teammate', label: 'Invite someone from your team', path: '/team' },
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
      <p>{completed} of {taskDefinitions.length} milestones complete. Each one uses real workspace activity.</p>
      <div className="owner-setup-progress" aria-label={`${percent}% of workspace setup complete`}><i style={{ transform: `scaleX(${percent / 100})` }} /></div>
      <Link className="button owner-setup-next" to={nextTask.path}>{nextTask.label}<ArrowUpRight size={16} /></Link>
    </div>
    <div className="owner-setup-tasks">
      {taskDefinitions.map((task, index) => <Link className={`${tasks[index] ? 'complete' : ''} ${index === nextTaskIndex ? 'next' : ''}`} key={task.key} to={task.path}>
        <span>{tasks[index] ? <Check size={13} /> : index + 1}</span>
        <b>{task.label}</b>
      </Link>)}
    </div>
    <div className="owner-setup-tally"><TallyMascot compact step={3} /></div>
  </section>;
}
