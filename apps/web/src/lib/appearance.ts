// How StockLedger looks on this device. It is a personal choice, so it stays in the browser
// and never changes what anyone else sees.
export type Accent = 'violet' | 'cobalt';
export type CardStyle = 'colourful' | 'single';
export type Appearance = { accent: Accent; cards: CardStyle };

const key = 'stockledger.appearance.v1';
export const defaultAppearance: Appearance = { accent: 'violet', cards: 'colourful' };

export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Appearance>;
    return {
      accent: saved.accent === 'cobalt' ? 'cobalt' : 'violet',
      cards: saved.cards === 'single' ? 'single' : 'colourful',
    };
  } catch {
    return defaultAppearance;
  }
}

export function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.accent = appearance.accent;
  document.documentElement.dataset.cards = appearance.cards;
}

export function saveAppearance(appearance: Appearance) {
  applyAppearance(appearance);
  try { localStorage.setItem(key, JSON.stringify(appearance)); } catch { /* The choice still applies until the page reloads. */ }
}
