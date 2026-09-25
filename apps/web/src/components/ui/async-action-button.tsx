import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type AsyncActionState = 'idle' | 'pending' | 'success';

type AsyncActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  state: AsyncActionState;
  idleLabel: ReactNode;
  pendingLabel: ReactNode;
  successLabel: ReactNode;
};

export function AsyncActionButton({
  className,
  disabled,
  idleLabel,
  pendingLabel,
  state,
  successLabel,
  type = 'submit',
  ...props
}: AsyncActionButtonProps) {
  const currentLabel = state === 'pending' ? pendingLabel : state === 'success' ? successLabel : idleLabel;

  return <button
    className={['button', 'async-action-button', `is-${state}`, className].filter(Boolean).join(' ')}
    data-state={state}
    disabled={disabled || state !== 'idle'}
    type={type}
    {...props}
  >
    <span className="async-action-labels" aria-hidden="true">
      <span className="async-action-label is-idle">{idleLabel}</span>
      <span className="async-action-label is-pending">{pendingLabel}</span>
      <span className="async-action-label is-success">{successLabel}</span>
    </span>
    <ActionStateIcon state={state} />
    <span className="sr-only" aria-live="polite">{currentLabel}</span>
  </button>;
}

function ActionStateIcon({ state }: { state: AsyncActionState }) {
  return <svg
    aria-hidden="true"
    className="async-action-icon"
    data-state={state}
    fill="none"
    height="18"
    viewBox="0 0 24 24"
    width="18"
  >
    <path className="async-action-arrow" d="M5 12h13m-5-5 5 5-5 5" />
    <circle className="async-action-spinner" cx="12" cy="12" r="7.5" />
    <path className="async-action-check" d="m7.5 12.5 3 3 6.5-7" />
  </svg>;
}
