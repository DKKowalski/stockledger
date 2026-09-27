import { useState } from 'react';

type TallyMascotProps = {
  step?: 0 | 1 | 2 | 3 | 4;
  compact?: boolean;
  celebrating?: boolean;
};

const tips = [
  'This helps me shape the setup around the way your business moves stock.',
  'Every quantity needs a home. You can add more shops and warehouses later.',
  'Choose what matches today. Your first item can still be added another way.',
  'Preview the rows before importing. Nothing is saved until you press the import button.',
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
        <ellipse className="tally-shadow" cx="120" cy="245" rx="52" ry="9" />
        <g className="tally-character">
          <path className="tally-leg tally-leg-left" d="M96 217v18" />
          <path className="tally-leg tally-leg-right" d="M144 217v18" />
          <path className="tally-foot tally-foot-left" d="M96 234c-5 0-10 3-12 8h21c0-4-4-8-9-8Z" />
          <path className="tally-foot tally-foot-right" d="M144 234c5 0 10 3 12 8h-21c0-4 4-8 9-8Z" />
          <path className="tally-arm tally-arm-left" d="M58 137c-17 6-22 20-14 31" />
          <path className="tally-arm tally-arm-right" d="M182 137c18-2 26-14 23-27" />
          <circle className="tally-hand tally-hand-left" cx="45" cy="168" r="4" />
          <circle className="tally-hand tally-hand-right" cx="205" cy="107" r="4" />
          <g className="tally-tag">
            <path className="tally-tag-body" d="M89 42h62l34 40v109c0 19-15 34-34 34H89c-19 0-34-15-34-34V82l34-40Z" />
            <circle className="tally-tag-eyelet" cx="120" cy="69" r="10" />
            <path className="tally-tag-eyelet-shine" d="M116 65c2-2 5-2 7 0" />
            <rect className="tally-label" x="75" y="99" width="90" height="96" rx="25" />
            <g className="tally-face">
              <circle className="tally-eye tally-eye-left" cx="103" cy="132" r="4.5" />
              <circle className="tally-eye tally-eye-right" cx="137" cy="132" r="4.5" />
              <path className="tally-mouth" d="M109 147c7 7 15 7 22 0" />
            </g>
            <g className="tally-marks">
              <path className="tally-mark" d="M101 166v15" />
              <path className="tally-mark" d="M112 166v15" />
              <path className="tally-mark" d="M123 166v15" />
              <path className="tally-mark" d="M134 166v15" />
              <path className="tally-mark tally-mark-slash" d="m98 180 39-13" />
            </g>
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
