const MARK_PATH = 'M2.5 4.75h15.25a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h14.5';

type StockLedgerMarkProps = {
  size?: number;
  className?: string;
  animated?: boolean;
};

export function StockLedgerMark({ size = 24, className, animated = false }: StockLedgerMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={animated ? ['logo-loader', className].filter(Boolean).join(' ') : className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {animated && (
        <path
          className="logo-loader-track"
          d={MARK_PATH}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.75"
        />
      )}
      <path
        className={animated ? 'logo-loader-dash' : undefined}
        d={MARK_PATH}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.75"
      />
    </svg>
  );
}
