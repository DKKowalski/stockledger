type IconProps = {
  className?: string;
  size?: number;
};

export function MenuMorphIcon({ open, size = 20 }: IconProps & { open: boolean }) {
  return <svg
    aria-hidden="true"
    className={`menu-morph-icon ${open ? 'is-open' : ''}`}
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <path className="menu-morph-top" d="M4 7h16" />
    <path className="menu-morph-middle" d="M4 12h16" />
    <path className="menu-morph-bottom" d="M4 17h16" />
  </svg>;
}

export function SuccessMark({ className, size = 32 }: IconProps) {
  return <svg
    aria-hidden="true"
    className={['success-mark', className].filter(Boolean).join(' ')}
    height={size}
    viewBox="0 0 32 32"
    width={size}
  >
    <circle className="success-mark-ring" cx="16" cy="16" r="13.5" />
    <path className="success-mark-check" d="m10.25 16.25 3.65 3.6 7.85-8" />
  </svg>;
}

export function EmptyInventoryIcon({ className, size = 38 }: IconProps) {
  return <svg
    aria-hidden="true"
    className={['empty-inventory-icon', className].filter(Boolean).join(' ')}
    fill="none"
    height={size}
    viewBox="0 0 40 40"
    width={size}
  >
    <path className="empty-inventory-body" d="M7.5 14.5 20 20.75l12.5-6.25v13L20 33.75 7.5 27.5z" />
    <path className="empty-inventory-spine" d="M20 20.75v13" />
    <path className="empty-inventory-lid" d="m7.5 14.5 12.5-6 12.5 6L20 20.75z" />
    <path className="empty-inventory-slot" d="M16.5 12.15 23 15.3" />
  </svg>;
}
