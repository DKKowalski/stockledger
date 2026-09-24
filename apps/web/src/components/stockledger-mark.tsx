const MARK_PATH = 'M2.5 4.75h15.25a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h14.5';

type StockLedgerMarkProps = {
  size?: number;
  className?: string;
  animated?: boolean;
};

export function StockLedgerMark({ size = 24, className, animated = false }: StockLedgerMarkProps) {
  const classes = ['stockledger-mark', animated ? 'logo-loader' : '', className].filter(Boolean).join(' ');

  return (
    <svg
      aria-hidden="true"
      className={classes}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {animated ? <>
        <path
          className="logo-loader-track"
          d={MARK_PATH}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.75"
        />
        <path
          className="logo-loader-dash"
          d={MARK_PATH}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.75"
        />
      </> : <>
        <path
          className="stockledger-mark-part stockledger-mark-top"
          d="M2.5 4.75h15.25"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.75"
        />
        <path
          className="stockledger-mark-part stockledger-mark-fold"
          d="M17.75 4.75a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.75"
        />
        <path
          className="stockledger-mark-part stockledger-mark-bottom"
          d="M7 16.75h14.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.75"
        />
        <circle className="stockledger-mark-spark" cx="20.25" cy="7.75" fill="currentColor" r="1.15" />
      </>}
    </svg>
  );
}
