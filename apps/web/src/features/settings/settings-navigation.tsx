import { Activity, BookType, Boxes, Building2, Database, ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export function SettingsNavigation() {
  return <nav className="settings-navigation" aria-label="Business settings sections">
    <NavLink end to="/settings"><Building2 size={16} />Business</NavLink>
    <NavLink to="/settings/inventory"><Boxes size={16} />Inventory</NavLink>
    <NavLink to="/settings/security"><ShieldCheck size={16} />Security</NavLink>
    <NavLink to="/settings/terminology"><BookType size={16} />Words</NavLink>
    <NavLink to="/settings/activity"><Activity size={16} />Activity</NavLink>
    <NavLink to="/settings/data"><Database size={16} />Data</NavLink>
  </nav>;
}
