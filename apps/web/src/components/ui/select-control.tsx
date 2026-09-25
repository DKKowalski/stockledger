import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type SelectControlProps = {
  'aria-label': string;
  className?: string;
  disabled?: boolean;
  name?: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  required?: boolean;
  value: string;
};

export function SelectControl({ className, disabled, name, onValueChange, options, required, value, ...props }: SelectControlProps) {
  const optionLabel = (label: ReactNode) => <span className="select-option-label">{label}</span>;
  const items = options.map((option) => ({ label: optionLabel(option.label), value: option.value || null }));

  return <Select.Root<string>
    disabled={disabled}
    items={items}
    name={name}
    onValueChange={(nextValue) => onValueChange(nextValue ?? '')}
    required={required}
    value={value || null}
  >
    <Select.Trigger className={['select-trigger', className].filter(Boolean).join(' ')} {...props}>
      <Select.Value className="select-value" />
      <Select.Icon className="select-icon"><ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner alignItemWithTrigger={false} className="select-positioner" sideOffset={6}>
        <Select.Popup className="select-popup">
          <Select.ScrollUpArrow className="select-scroll-arrow"><ChevronUp size={14} /></Select.ScrollUpArrow>
          <Select.List className="select-list">
            {options.map((option) => <Select.Item
              className="select-item"
              disabled={option.disabled || (required && option.value === '')}
              key={option.value || '__empty'}
              value={option.value || null}
            >
              <Select.ItemIndicator className="select-item-indicator"><Check size={14} strokeWidth={2.2} /></Select.ItemIndicator>
              <Select.ItemText className="select-item-text">{optionLabel(option.label)}</Select.ItemText>
            </Select.Item>)}
          </Select.List>
          <Select.ScrollDownArrow className="select-scroll-arrow"><ChevronDown size={14} /></Select.ScrollDownArrow>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
