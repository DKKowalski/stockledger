import { Activity, Building2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export function SettingsNavigation() {
  return <nav className="settings-navigation" aria-label="Business settings sections">
    <NavLink end to="/settings"><Building2 size={16} />Business</NavLink>
    <NavLink to="/settings/activity"><Activity size={16} />Activity</NavLink>
  </nav>;
}
