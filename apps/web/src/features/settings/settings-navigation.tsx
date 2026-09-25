import { Activity, Building2, Database } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export function SettingsNavigation() {
  return <nav className="settings-navigation" aria-label="Business settings sections">
    <NavLink end to="/settings"><Building2 size={16} />Business</NavLink>
    <NavLink to="/settings/activity"><Activity size={16} />Activity</NavLink>
    <NavLink to="/settings/data"><Database size={16} />Data</NavLink>
  </nav>;
}
