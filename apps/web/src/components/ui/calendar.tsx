import { Popover } from '@base-ui/react/popover';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore, type ChangeEvent, type ReactNode, type RefObject } from 'react';
import { DayPicker, type DayButtonProps, type DayPickerProps, type DropdownProps } from 'react-day-picker';
import { useCompanySettings } from '../../app/company-settings-store';
import { companyDay } from '../../lib/date-range';
import { calendarDateValue, parseCalendarDate } from '../../lib/calendar-date';
import { SelectControl } from './select-control';

function CalendarDropdown({ options, value, onChange, disabled, ...props }: DropdownProps) {
  return <SelectControl className="calendar-caption-select" popupClassName="calendar-caption-positioner" aria-label={props['aria-label'] ?? 'Calendar navigation'} disabled={disabled} value={String(value)} options={(options ?? []).map(option => ({ ...option, value: String(option.value) }))} onValueChange={value => onChange?.({ target: { value } } as ChangeEvent<HTMLSelectElement>)} />;
}
function CalendarChevron({ orientation }: { orientation?: string }) {
  return orientation === 'left' ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />;
}
function CalendarDayButton({ day, modifiers, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!modifiers.focused || !ref.current) return;
    const button = ref.current;
    button.focus({ preventScroll: true });
    // Reveal keyboard focus inside a short popup without scrolling the underlying form.
    const content = button.closest<HTMLElement>('.calendar-content');
    if (!content) return;
    const dayBox = button.getBoundingClientRect();
    const viewport = content.getBoundingClientRect();
    if (dayBox.top < viewport.top) content.scrollTop -= viewport.top - dayBox.top;
    else if (dayBox.bottom > viewport.bottom) content.scrollTop += dayBox.bottom - viewport.bottom;
  }, [modifiers.focused]);
  return <button ref={ref} data-day={calendarDateValue(day.date)} {...props} />;
}
const subscribe = (notify: () => void) => {
  const query = window.matchMedia('(max-width: 640px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export function Calendar({ range = false, ...props }: DayPickerProps & { range?: boolean }) {
  const { settings } = useCompanySettings();
  const phone = useSyncExternalStore(subscribe, () => window.matchMedia('(max-width: 640px)').matches, () => false);
  const today = parseCalendarDate(companyDay(settings?.timeZone))!;
  return <DayPicker className="stock-calendar" weekStartsOn={1} captionLayout="dropdown" navLayout="around" numberOfMonths={range && !phone ? 2 : 1} fixedWeeks today={today} startMonth={new Date(1900, 0)} endMonth={new Date(today.getFullYear() + 20, 11)} components={{ DayButton: CalendarDayButton, Dropdown: CalendarDropdown, Chevron: CalendarChevron }} {...props} />;
}

export function CalendarPopup({ children, label, footer, returnFocus }: { children: ReactNode; label: string; footer?: ReactNode; returnFocus: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreFocus = () => {
    const active = document.activeElement;
    // A calendar opened by the preset menu still returns to its own trigger.
    // Respect focus that has already moved to another field during the exit motion.
    return active === document.body || ref.current?.contains(active) ? returnFocus.current : false;
  };
  return <Popover.Portal>
    <Popover.Positioner className="calendar-positioner" sideOffset={6} collisionPadding={12} align="start">
      <Popover.Popup ref={ref} className="calendar-popup" aria-label={label} initialFocus={ref} finalFocus={restoreFocus}>
        <div className="calendar-content">{children}</div>
        {footer}
      </Popover.Popup>
    </Popover.Positioner>
  </Popover.Portal>;
}
