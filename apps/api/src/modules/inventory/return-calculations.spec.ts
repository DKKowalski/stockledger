import { describe, it, expect } from 'vitest';
import { allocateReturn, type OriginalPortion } from './return-calculations.js';
const portions: OriginalPortion[] = [
  { movementId: 'a', itemId: 'water', quantity: 1, returned: 0, unitPriceCents: 184, unitCostCents: 101 },
  { movementId: 'b', itemId: 'water', quantity: 1, returned: 0, unitPriceCents: 183, unitCostCents: 101 },
  { movementId: 'c', itemId: 'water', quantity: 1, returned: 0, unitPriceCents: 183, unitCostCents: 100 },
];
describe('original-allocation returns', () => {
  it('conserves the original net price and exact assigned cost across partial returns', () => {
    const source = structuredClone(portions);
    const results = [];
    for (let i = 0; i < 3; i++) {
      const r = allocateReturn(source, [{ itemId: 'water', quantity: 1, disposition: 'resellable' }]);
      results.push(r);
      for (const a of r.allocations)
        source.find((p) => p.movementId === a.originalMovementId)!.returned += a.quantity;
    }
    expect(results.map((r) => r.refundCents)).toEqual([184, 183, 183]);
    expect(results.map((r) => r.cogsCents)).toEqual([101, 101, 100]);
    expect(() =>
      allocateReturn(source, [{ itemId: 'water', quantity: 1, disposition: 'resellable' }]),
    ).toThrow();
  });
  it('assigns identical original costs for damaged goods without claiming restock', () => {
    const r = allocateReturn(portions, [{ itemId: 'water', quantity: 3, disposition: 'damaged' }]);
    expect(r).toMatchObject({ refundCents: 550, cogsCents: 302 });
    expect(r.allocations.every((a) => a.disposition === 'damaged')).toBe(true);
  });
  it('never guesses absent snapshots or exceeds original quantities', () => {
    for (const change of [{ unitCostCents: null }, { unitPriceCents: null }, { returned: 2 }])
      expect(() =>
        allocateReturn(
          [{ ...portions[0]!, ...change }],
          [{ itemId: 'water', quantity: 1, disposition: 'resellable' }],
        ),
      ).toThrow();
    expect(() =>
      allocateReturn(portions, [{ itemId: 'water', quantity: 4, disposition: 'resellable' }]),
    ).toThrow();
  });
});
