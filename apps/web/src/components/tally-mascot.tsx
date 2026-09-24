import { useState } from 'react';

type TallyMascotProps = {
  step?: 0 | 1 | 2 | 3;
  compact?: boolean;
  celebrating?: boolean;
};

const tips = [
  'This helps me shape the setup around the way your business moves stock.',
  'Every quantity needs a home. You can add more shops and warehouses later.',
  'Choose what matches today. Your first item can still be added another way.',
  'Your setup is saved. The next milestones happen inside your workspace.',
] as const;

export function TallyMascot({ step = 0, compact = false, celebrating = false }: TallyMascotProps) {
  const [tipOpen, setTipOpen] = useState(false);

  return <div className={`tally ${compact ? 'compact' : ''} ${celebrating ? 'is-celebrating' : ''} ${tipOpen ? 'is-engaged' : ''}`}>
    {tipOpen && <div className="tally-tip" role="status">{tips[step]}</div>}
    <button
      aria-expanded={tipOpen}
      aria-label={tipOpen ? 'Hide Tally tip' : 'Ask Tally for a tip'}
      className="tally-button"
      onClick={() => setTipOpen((open) => !open)}
      type="button"
    >
      <svg aria-hidden="true" className="tally-art" viewBox="0 0 240 270" xmlns="http://www.w3.org/2000/svg">
        <ellipse className="tally-shadow" cx="120" cy="244" rx="58" ry="10" />
        <g className="tally-character">
          <path className="tally-leg tally-leg-left" d="M95 216v22l-13 5" />
          <path className="tally-leg tally-leg-right" d="M145 216v22l13 5" />
          <path className="tally-arm tally-arm-left" d="M66 132c-16 8-21 22-12 33" />
          <path className="tally-arm tally-arm-right" d="M174 132c16 8 21 22 12 33" />
          <g className="tally-stack">
            <path className="tally-sheet tally-sheet-back" d="M72 61c0-8 6-14 14-14h82v52H86c-8 0-14-6-14-14V61Z" />
            <path className="tally-sheet tally-sheet-middle" d="M60 98c0-8 6-14 14-14h94v58H74c-8 0-14-6-14-14V98Z" />
            <path className="tally-sheet tally-sheet-face" d="M68 136c0-8 6-14 14-14h98v66c0 18-14 32-32 32H94c-14 0-26-12-26-26v-58Z" />
            <path className="tally-fold" d="M154 122v22c0 7 5 12 12 12h14" />
            <path className="tally-rule tally-rule-one" d="M91 70h48" />
            <path className="tally-rule tally-rule-two" d="M82 105h57" />
            <path className="tally-rule tally-rule-three" d="M91 177h58" />
            <g className="tally-face">
              <path className="tally-eye tally-eye-left" d="M96 151h1" />
              <path className="tally-eye tally-eye-right" d="M128 151h1" />
              <path className="tally-mouth" d="M105 164c5 5 11 5 16 0" />
            </g>
          </g>
          <g className="tally-count-tag">
            <path d="M154 51h29c6 0 11 5 11 11v25c0 6-5 11-11 11h-29V51Z" />
            <path d="M165 68h17M165 79h11" />
          </g>
        </g>
        {celebrating && <g className="tally-sparks">
          <path d="M48 72v12M42 78h12" />
          <path d="M198 119v14M191 126h14" />
          <path d="m185 38 4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Z" />
        </g>}
      </svg>
      <span className="tally-action">{tipOpen ? 'Thanks, Tally' : 'Ask Tally'}</span>
    </button>
  </div>;
}
