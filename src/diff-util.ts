/**
 * Word-level diff utility.
 * Marks words in `after` that are not present in `before` as added.
 * Used by the Analyzer tab for before/after prompt highlighting.
 */
export interface DiffWord {
  text: string;
  added: boolean;
}

export function computeDiff(before: string, after: string): DiffWord[] {
  const bWords = before.split(/\s+/).filter(Boolean);
  const aWords = after.split(/\s+/).filter(Boolean);
  const bSet = new Set(bWords);
  return aWords.map(w => ({ text: w, added: !bSet.has(w) }));
}
