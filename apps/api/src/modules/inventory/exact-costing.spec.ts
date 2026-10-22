import { describe, expect, it } from 'vitest';
import { EXACT_LIMIT, averageCost, issueValue, locationValues, receiveValue, splitCostComponents, validatePool } from './exact-costing.js';

describe('exact prospective moving-average value', () => {
  it('retains 302 cents of purchases and consumes every cent on the final sale', () => {
    const received = receiveValue({ quantity: 1, valueCents: 100 }, 2, 101);
    expect(received).toEqual({ receivedValueCents: 202, pool: { quantity: 3, valueCents: 302 } });
    expect(averageCost(received.pool)).toBe(101);
    let pool = received.pool; const costs = [];
    for (let i = 0; i < 3; i++) { const sale = issueValue(pool, 1); costs.push(sale.costCents); pool = sale.pool; }
    expect(costs).toEqual([101, 101, 100]); expect(pool).toEqual({ quantity: 0, valueCents: 0 });
  });
  it('preserves price portions and exact cost without another stock effect', () => {
    const parts = splitCostComponents([{ category: 'box', quantity: 1, unitPriceCents: 184, totalCents: 184 }, { category: 'box', quantity: 2, unitPriceCents: 183, totalCents: 366 }], 302);
    expect(parts.reduce((sum, p) => sum + p.quantity, 0)).toBe(3);
    expect(parts.reduce((sum, p) => sum + p.totalCents, 0)).toBe(550);
    expect(parts.reduce((sum, p) => sum + p.unitCostCents * p.quantity, 0)).toBe(302);
    expect(parts.map(p => [p.quantity, p.unitCostCents])).toEqual([[1, 101], [1, 101], [1, 100]]);
  });
  it('conserves value under varied receipts and issue groupings using integer arithmetic', () => {
    for (let q = 1; q < 60; q++) for (const valueCents of [0, 1, 99, 302, 10001, EXACT_LIMIT]) {
      let pool = { quantity: q, valueCents }; let consumed = 0;
      while (pool.quantity) { const result = issueValue(pool, Math.min(3, pool.quantity)); consumed += result.costCents; pool = result.pool; }
      expect(consumed).toBe(valueCents); expect(pool.valueCents).toBe(0);
    }
  });
  it('allocates location totals deterministically while preserving the company-wide pool', () => {
    const pool = { quantity: 3, valueCents: 302 };
    const positions = [{ locationId: 'b', quantity: 2 }, { locationId: 'a', quantity: 1 }];
    expect([...locationValues(pool, positions)]).toEqual([['a', 101], ['b', 201]]);
    expect([...locationValues(pool, positions.reverse())]).toEqual([['a', 101], ['b', 201]]);
  });
  it('refuses negative, fractional, inconsistent, oversized and unavailable quantities', () => {
    expect(averageCost({ quantity: 0, valueCents: 0 })).toBeNull();
    for (const pool of [{ quantity: 0, valueCents: 1 }, { quantity: -1, valueCents: 0 }, { quantity: 1.5, valueCents: 2 }]) expect(() => validatePool(pool)).toThrow();
    expect(() => issueValue({ quantity: 2, valueCents: 10 }, 3)).toThrow();
    expect(() => receiveValue({ quantity: 1, valueCents: EXACT_LIMIT }, 1, 1)).toThrow();
    expect(() => locationValues({ quantity: 2, valueCents: 10 }, [{ locationId: 'a', quantity: 1 }])).toThrow();
  });
});
