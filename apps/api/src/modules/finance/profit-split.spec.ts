import { describe, expect, it } from 'vitest';
import { allocateProfit, CAPITAL_PART_KEY, capitalAmountCents,DEFAULT_SPLIT_PARTS, percentToBasisPoints, validateSplitParts } from './profit-split.js';

const bps = DEFAULT_SPLIT_PARTS.map(part => part.percentBasisPoints);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('allocateProfit', () => {
  it('defaults add up to 100% and split a round amount cleanly', () => {
    expect(sum(bps)).toBe(10_000);
    expect(allocateProfit(100_000, bps)).toEqual([10_000, 20_000, 20_000, 20_000, 10_000, 20_000]);
  });

  it('gives leftover cents to the largest remainders, earlier part first on a tie', () => {
    expect(allocateProfit(100_001, bps)).toEqual([10_000, 20_001, 20_000, 20_000, 10_000, 20_000]);
    expect(allocateProfit(100_003, bps)).toEqual([10_000, 20_001, 20_001, 20_001, 10_000, 20_000]);
    // 3 parts of 33.33 / 33.33 / 33.34 over 1 cent: only the biggest remainder gets it.
    expect(allocateProfit(1, [3333, 3333, 3334])).toEqual([0, 0, 1]);
  });

  it('always sums exactly to the net profit, including 2-decimal percents', () => {
    const shapes = [bps, [3333, 3333, 3334], [1, 9999], [1234, 5678, 3088], [10_000], [3333, 3333, 3333, 1]];
    for (const shape of shapes) for (const net of [1, 2, 3, 7, 99, 100, 101, 12_345, 99_999, 1_000_003, 2_147_483_647]) {
      const parts = allocateProfit(net, shape);
      expect(sum(parts)).toBe(net);
      parts.forEach((amount, i) => expect(Math.abs(amount - (net * shape[i]!) / 10_000)).toBeLessThan(1));
    }
  });

  it('gives a single part the whole profit', () => {
    expect(allocateProfit(98_765, [10_000])).toEqual([98_765]);
  });

  it('allocates nothing for a loss or zero', () => {
    expect(allocateProfit(0, bps)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(allocateProfit(-500, bps)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('percentToBasisPoints', () => {
  it('accepts whole numbers and up to two decimals only', () => {
    expect(percentToBasisPoints(10)).toBe(1000);
    expect(percentToBasisPoints(33.33)).toBe(3333);
    expect(percentToBasisPoints(0.07)).toBe(7);
    expect(percentToBasisPoints(33.333)).toBeNull();
    expect(percentToBasisPoints(0)).toBeNull();
    expect(percentToBasisPoints(-5)).toBeNull();
    expect(percentToBasisPoints(100.01)).toBeNull();
    expect(percentToBasisPoints(Number.NaN)).toBeNull();
  });
});

describe('validateSplitParts', () => {
  const part = (percent: number, name = 'Part') => ({ name, destination: 'Somewhere', percent });
  it('accepts parts that total exactly 100%', () => {
    expect(validateSplitParts([part(33.33), part(33.33), part(33.34)])).toMatchObject({ parts: [{ percentBasisPoints: 3333 }, { percentBasisPoints: 3333 }, { percentBasisPoints: 3334 }] });
    expect(validateSplitParts([part(100)])).toHaveProperty('parts');
  });
  it('rejects a total other than 100%', () => {
    expect(validateSplitParts([part(50), part(49.99)])).toHaveProperty('error');
    expect(validateSplitParts([part(60), part(50)])).toHaveProperty('error');
  });
  it('rejects zero parts and more than ten', () => {
    expect(validateSplitParts([])).toHaveProperty('error');
    expect(validateSplitParts(Array.from({ length: 11 }, () => part(100 / 11)))).toHaveProperty('error');
    expect(validateSplitParts(Array.from({ length: 10 }, () => part(10)))).toHaveProperty('parts');
  });
  it('rejects negative, zero and over-precise percents, blank text and duplicate keys', () => {
    expect(validateSplitParts([part(-10), part(110)])).toHaveProperty('error');
    expect(validateSplitParts([part(0), part(100)])).toHaveProperty('error');
    expect(validateSplitParts([part(50.005), part(49.995)])).toHaveProperty('error');
    expect(validateSplitParts([part(50, ' '), part(50)])).toHaveProperty('error');
    expect(validateSplitParts([{ ...part(50), key: 'a' }, { ...part(50), key: 'a' }])).toHaveProperty('error');
  });
});

describe('stock capital', () => {
  it('takes the Finance COGS actual as is, and only positive COGS is something to bank', () => {
    expect(capitalAmountCents(80_000)).toBe(80_000);
    expect(capitalAmountCents(1)).toBe(1);
    expect(capitalAmountCents(0)).toBe(0);
    expect(capitalAmountCents(-1000)).toBe(0);
    expect(capitalAmountCents(null)).toBe(0);
    expect(capitalAmountCents(Number.NaN)).toBe(0);
  });

  it('does not depend on profit: a loss month has no profit parts but still has capital', () => {
    expect(allocateProfit(-400, bps).every(amount => amount === 0)).toBe(true);
    expect(capitalAmountCents(500)).toBe(500);
  });

  it('reserves the capital part key so settings can never use it', () => {
    expect(CAPITAL_PART_KEY).toBe('capital');
    expect(validateSplitParts([{ key: 'capital', name: 'Other', destination: 'Somewhere', percent: 100 }])).toEqual({ error: expect.stringContaining('reserved') });
    expect(validateSplitParts([{ key: 'capital-2', name: 'Fine', destination: 'Somewhere', percent: 100 }])).toHaveProperty('parts');
  });
});
