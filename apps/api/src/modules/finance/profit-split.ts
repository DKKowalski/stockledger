// Profit split: pure allocation and validation. Money is integer cents and percents are basis points
// (1 bp = 0.01%), so the parts always add up to the month's net profit exactly.
export const MAX_SPLIT_PARTS = 10;
export const TOTAL_BASIS_POINTS = 10_000;

// Stock capital: the month's Cost of Goods Sold, banked separately from the profit split. It is stored in
// the same completions table under a reserved part key, so a profit part can never use that key.
export const CAPITAL_PART_KEY = 'capital';
export const CAPITAL_PART_NAME = 'Stock capital';
export const CAPITAL_DESTINATION = 'Capital account (restock)';

// COGS is shown exactly as Finance computes it; only an amount above zero is something to bank.
export function capitalAmountCents(cogsCents: number | null | undefined): number {
  return typeof cogsCents === 'number' && Number.isSafeInteger(cogsCents) && cogsCents > 0 ? cogsCents : 0;
}

export type SplitPartInput = { key?: string; name: string; destination: string; percent: number };
export type SplitPartSetting = { key: string; name: string; destination: string; percentBasisPoints: number };
export type ValidSplitPart = { key?: string; name: string; destination: string; percentBasisPoints: number };

export const DEFAULT_SPLIT_PARTS: readonly SplitPartSetting[] = [
  { key: 'default-1', name: 'Tax reserve', destination: 'Tax account', percentBasisPoints: 1000 },
  { key: 'default-2', name: 'Top up emergency reserve', destination: 'Reserve account (Target: 1–3 months of expenses)', percentBasisPoints: 2000 },
  { key: 'default-3', name: 'Reinvest in inventory/tools', destination: 'Business (high-margin SKUs)', percentBasisPoints: 2000 },
  { key: 'default-4', name: "Pay owner's draw", destination: 'Personal account', percentBasisPoints: 2000 },
  { key: 'default-5', name: 'Repay debt / clear supplier', destination: 'Creditors', percentBasisPoints: 1000 },
  { key: 'default-6', name: 'Growth fund', destination: 'Growth savings account', percentBasisPoints: 2000 },
];

// Largest remainder: every part gets the floor of its exact share, then the cents still unassigned go
// one each to the parts with the biggest fractional remainder (earlier part first on a tie).
export function allocateProfit(netProfitCents: number, basisPoints: readonly number[]): number[] {
  if (!Number.isSafeInteger(netProfitCents) || netProfitCents <= 0) return basisPoints.map(() => 0);
  const shares = basisPoints.map((bp, index) => ({ index, floor: Math.floor((netProfitCents * bp) / TOTAL_BASIS_POINTS), remainder: (netProfitCents * bp) % TOTAL_BASIS_POINTS }));
  let left = netProfitCents - shares.reduce((sum, share) => sum + share.floor, 0);
  const amounts = shares.map(share => share.floor);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left <= 0) break;
    amounts[share.index]! += 1;
    left -= 1;
  }
  return amounts;
}

// Whole numbers or up to two decimals only; returns null when the percent is not representable.
export function percentToBasisPoints(percent: number): number | null {
  if (!Number.isFinite(percent)) return null;
  const bp = Math.round(percent * 100);
  if (Math.abs(percent * 100 - bp) > 1e-6 || bp < 1 || bp > TOTAL_BASIS_POINTS) return null;
  return bp;
}

// Returns the validated parts or a plain-language problem; the caller maps a problem to a 400.
export function validateSplitParts(parts: readonly SplitPartInput[]): { parts: ValidSplitPart[] } | { error: string } {
  if (parts.length < 1 || parts.length > MAX_SPLIT_PARTS) return { error: `Use between 1 and ${MAX_SPLIT_PARTS} parts` };
  const out: ValidSplitPart[] = [];
  for (const part of parts) {
    const name = part.name.trim();
    const destination = part.destination.trim();
    if (!name || !destination) return { error: 'Every part needs a name and a destination' };
    const percentBasisPoints = percentToBasisPoints(part.percent);
    if (percentBasisPoints === null) return { error: 'Percents must be above 0, at most 100, and have at most 2 decimals' };
    out.push({ key: part.key, name, destination, percentBasisPoints });
  }
  if (out.some(part => part.key === CAPITAL_PART_KEY)) return { error: `"${CAPITAL_PART_KEY}" is reserved for stock capital and can't be used as a part key` };
  const keys = out.map(part => part.key).filter((key): key is string => Boolean(key));
  if (new Set(keys).size !== keys.length) return { error: 'Part keys must be unique' };
  const total = out.reduce((sum, part) => sum + part.percentBasisPoints, 0);
  if (total !== TOTAL_BASIS_POINTS) return { error: `Percents must total exactly 100% (now ${total / 100}%)` };
  return { parts: out };
}
