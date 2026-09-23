type LedgerSyncIconProps = {
  active?: boolean;
  className?: string;
  size?: number;
};

export function LedgerSyncIcon({ active = false, className, size = 20 }: LedgerSyncIconProps) {
  return <svg
    aria-hidden="true"
    className={['ledger-sync-icon', active ? 'is-active' : '', className].filter(Boolean).join(' ')}
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <g className="ledger-sync-row ledger-sync-row-one">
      <rect className="ledger-sync-cell" height="4" rx="1" width="4" x="3" y="4.5" />
      <path className="ledger-sync-line" d="M10 6.5h10.5" />
    </g>
    <g className="ledger-sync-row ledger-sync-row-two">
      <rect className="ledger-sync-cell" height="4" rx="1" width="4" x="4.5" y="10" />
      <path className="ledger-sync-line" d="M10 12h10.5" />
    </g>
    <g className="ledger-sync-row ledger-sync-row-three">
      <rect className="ledger-sync-cell" height="4" rx="1" width="4" x="3.75" y="15.5" />
      <path className="ledger-sync-line" d="M10 17.5h10.5" />
    </g>
    <path className="ledger-sync-scan" d="M3 2.5v19" />
  </svg>;
}
