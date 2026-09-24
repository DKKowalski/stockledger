import { Tooltip } from '@base-ui/react/tooltip';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Root>
    <Tooltip.Trigger aria-label={label} className="info-tooltip-trigger"><Info aria-hidden="true" size={14} /></Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner className="info-tooltip-positioner" side="top" sideOffset={8}>
        <Tooltip.Popup className="info-tooltip-popup">
          {children}
          <Tooltip.Arrow className="info-tooltip-arrow" />
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
