import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';

export function UiProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider closeDelay={80} delay={450} timeout={500}>{children}</Tooltip.Provider>;
}
