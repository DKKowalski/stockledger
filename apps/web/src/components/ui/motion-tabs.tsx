import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export type MotionTabItem<Value extends string> = {
  value: Value;
  label: string;
};

type MotionTabsProps<Value extends string> = {
  'aria-label': string;
  items: readonly MotionTabItem<Value>[];
  onValueChange: (value: Value) => void;
  value: Value;
};

export function MotionTabs<Value extends string>({ items, onValueChange, value, ...props }: MotionTabsProps<Value>) {
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<Value, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const activeButton = buttonRefs.current.get(value);
    if (!activeButton) return;
    setIndicator({ left: activeButton.offsetLeft, width: activeButton.offsetWidth });
  }, [value]);

  useLayoutEffect(() => {
    measure();
    const frame = window.requestAnimationFrame(() => setReady(true));
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    const activeButton = buttonRefs.current.get(value);
    if (activeButton) observer.observe(activeButton);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [items, measure, value]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = items[nextIndex];
    onValueChange(next.value);
    buttonRefs.current.get(next.value)?.focus();
  };

  return <div
    aria-label={props['aria-label']}
    className={`motion-tabs ${ready ? 'is-ready' : ''}`}
    ref={listRef}
    role="tablist"
  >
    <span
      aria-hidden="true"
      className="motion-tabs-indicator"
      style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
    />
    {items.map((item, index) => <button
      aria-selected={value === item.value}
      className={value === item.value ? 'active' : ''}
      key={item.value}
      onClick={() => onValueChange(item.value)}
      onKeyDown={(event) => moveFocus(event, index)}
      ref={(node) => {
        if (node) buttonRefs.current.set(item.value, node);
        else buttonRefs.current.delete(item.value);
      }}
      role="tab"
      tabIndex={value === item.value ? 0 : -1}
      type="button"
    >{item.label}</button>)}
  </div>;
}
