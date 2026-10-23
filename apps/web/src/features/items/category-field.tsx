import { useState } from 'react';
import { SelectControl } from '../../components/inventory-ui';
import { InputControl } from '../../components/ui/input-control';
import { sameName } from '../../lib/item-names';

const NEW_CATEGORY = '__new__';

/** Pick a category the business already uses, or type a new one. */
export function CategoryField({ categories, value, onValueChange }: { categories: readonly string[]; value: string; onValueChange: (value: string) => void }) {
  const [typingNew, setTypingNew] = useState(() => value !== '' && !categories.includes(value));
  const typing = typingNew || !categories.length;
  const match = typing && value.trim() ? categories.find((category) => sameName(category, value)) : undefined;

  return <div className="category-field">
    <label>
      <span className="category-field-label">Category{categories.length > 0 && typing && <button className="link-button" type="button" onClick={() => { setTypingNew(false); onValueChange(''); }}>Pick from list</button>}</span>
      {typing
        ? <InputControl autoFocus={typingNew} required maxLength={80} placeholder={categories.length ? 'Type the new category' : 'For example, Drinks'} value={value} onValueChange={onValueChange} />
        : <SelectControl
          aria-label="Category"
          required
          value={value}
          onValueChange={(next) => {
            setTypingNew(next === NEW_CATEGORY);
            onValueChange(next === NEW_CATEGORY ? '' : next);
          }}
          options={[{ value: '', label: 'Choose a category' }, ...categories.map((category) => ({ value: category, label: category })), { value: NEW_CATEGORY, label: '+ New category' }]}
        />}
    </label>
    {match && <small className="field-hint">You already have “{match}”. It will be used.</small>}
  </div>;
}
