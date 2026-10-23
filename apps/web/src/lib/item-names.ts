const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Names that differ only in capitals or spacing are the same item or category. */
export const sameName = (left: string, right: string) => nameKey(left) === nameKey(right);

/** Uses the existing spelling when a typed category matches one already in use. */
export function knownCategory(categories: readonly string[], value: string) {
  return categories.find((category) => sameName(category, value)) ?? value.trim().replace(/\s+/g, ' ');
}
