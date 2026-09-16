type StockLedgerMarkProps = {
  size?: number;
  className?: string;
};

export function StockLedgerMark({ size = 24, className }: StockLedgerMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 4.75h15.25a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h14.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.75"
      />
    </svg>
  );
}
