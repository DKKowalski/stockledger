import { Check } from 'lucide-react';
import { useState } from 'react';
import { Panel } from '../../components/inventory-ui';
import { readAppearance, saveAppearance, type Accent, type Appearance, type CardStyle } from '../../lib/appearance';

const accents: readonly { value: Accent; label: string; swatches: readonly string[] }[] = [
  { value: 'violet', label: 'Electric violet', swatches: ['#5b3df5', '#ff6a4d', '#d4ff3a'] },
  { value: 'cobalt', label: 'Cobalt', swatches: ['#2449ff', '#ff7a1a', '#ffd84d'] },
];

const cardStyles: readonly { value: CardStyle; label: string; hint: string }[] = [
  { value: 'colourful', label: 'Colourful', hint: 'Each summary card has its own colour.' },
  { value: 'single', label: 'One colour', hint: 'Summary cards on Overview, Items and Profit use the same calm colour.' },
];

export function AppearancePanel() {
  const [appearance, setAppearance] = useState(readAppearance);
  const choose = (next: Appearance) => { setAppearance(next); saveAppearance(next); };

  return <Panel title="Appearance" subtitle="Only changes how StockLedger looks on this device. Your team keeps their own choice." className="spaced">
    <div className="appearance-groups">
      <fieldset className="appearance-group">
        <legend>Colour theme</legend>
        <div className="appearance-options">
          {accents.map((accent) => <label key={accent.value} className={`appearance-option ${appearance.accent === accent.value ? 'selected' : ''}`}>
            <input type="radio" name="appearance-accent" checked={appearance.accent === accent.value} onChange={() => choose({ ...appearance, accent: accent.value })} />
            <span className="appearance-swatches" aria-hidden="true">{accent.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>
            <b>{accent.label}</b>
            {appearance.accent === accent.value && <Check className="appearance-check" size={16} aria-hidden="true" />}
          </label>)}
        </div>
      </fieldset>
      <fieldset className="appearance-group">
        <legend>Summary cards</legend>
        <div className="appearance-options">
          {cardStyles.map((style) => <label key={style.value} className={`appearance-option ${appearance.cards === style.value ? 'selected' : ''}`}>
            <input type="radio" name="appearance-cards" checked={appearance.cards === style.value} onChange={() => choose({ ...appearance, cards: style.value })} />
            <span className={`appearance-cards-preview is-${style.value}`} aria-hidden="true"><i /><i /><i /><i /></span>
            <b>{style.label}</b>
            <small>{style.hint}</small>
            {appearance.cards === style.value && <Check className="appearance-check" size={16} aria-hidden="true" />}
          </label>)}
        </div>
      </fieldset>
    </div>
  </Panel>;
}
