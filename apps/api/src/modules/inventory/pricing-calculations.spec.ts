import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { calculatePrice, validatePricingRules, type PricingRules } from './pricing-calculations.js';

const rules: PricingRules = {
  package: { label: 'box', size: 10, priceCents: 12_000 },
  bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1_300 }],
};

describe('authoritative pricing preview', () => {
  it.each([[2, 3000], [7, 9100], [10, 12000], [11, 13500], [15, 18500],
    [19, 23700], [20, 24000], [23, 28500], [25, 30500]])('prices %i pieces at %i cents', (quantity, totalCents) => {
    expect(calculatePrice(1500, quantity, rules).totalCents).toBe(totalCents);
  });

  it('uses the highest qualifying all-units tier for the remainder', () => {
    const configured = { ...rules, bulkTiers: [
      { minimumQuantity: 3, unitPriceCents: 1400 },
      { minimumQuantity: 5, unitPriceCents: 1300 },
    ] };
    expect(calculatePrice(1500, 14, configured).totalCents).toBe(17600);
    expect(calculatePrice(1500, 15, configured).totalCents).toBe(18500);
    expect(calculatePrice(1500, 16, configured).totalCents).toBe(19800);
  });

  it('applies tiers to the full quantity when no package is configured', () => {
    expect(calculatePrice(1500, 25, { package: null, bulkTiers: rules.bulkTiers }).totalCents).toBe(32500);
  });

  it('preserves unset and explicit-zero retail prices', () => {
    expect(() => calculatePrice(null, 1)).toThrow(ConflictException);
    expect(calculatePrice(0, 3)).toMatchObject({ totalCents: 0, grossSalesCents: 0, automaticDiscountCents: 0 });
  });

  it('allocates indivisible box prices exactly, including repeated boxes', () => {
    const price = calculatePrice(500, 48, { package: { label: 'carton', size: 24, priceCents: 10000 }, bulkTiers: [] });
    expect(price.components).toEqual([
      { category: 'box', quantity: 32, unitPriceCents: 417, totalCents: 13344 },
      { category: 'box', quantity: 16, unitPriceCents: 416, totalCents: 6656 },
    ]);
    expect(price.totalCents).toBe(20000);
  });

  it('conserves quantities, net revenue and discount amounts across boundaries', () => {
    for (let quantity = 1; quantity <= 250; quantity++) {
      const result = calculatePrice(1500, quantity, rules);
      expect(result.components.reduce((sum, part) => sum + part.quantity, 0)).toBe(quantity);
      expect(result.components.reduce((sum, part) => sum + part.quantity * part.unitPriceCents, 0)).toBe(result.totalCents);
      expect(result.grossSalesCents - result.automaticDiscountCents).toBe(result.totalCents);
      expect(result).toEqual(calculatePrice(1500, quantity, rules));
    }
  });

  it.each([0, -1, 1.5, Number.NaN, 2147483648])('rejects invalid quantity %s', (quantity) => {
    expect(() => calculatePrice(1500, quantity, rules)).toThrow(BadRequestException);
  });

  it('rejects unsafe totals instead of rounding financial amounts', () => {
    expect(() => calculatePrice(2147483647, 2147483647)).toThrow(BadRequestException);
  });

  it('identifies all-units and package boundaries where adding a unit reduces the total', () => {
    expect(calculatePrice(1500, 2, { package: null, bulkTiers: [{ minimumQuantity: 3, unitPriceCents: 700 }] }).priceDropQuantities).toEqual([3]);
    expect(calculatePrice(1500, 2, { package: { label: 'box', size: 10, priceCents: 1000 }, bulkTiers: [] }).priceDropQuantities).toEqual([10]);
    expect(calculatePrice(1500, 2, rules).priceDropQuantities).toEqual([]);
  });

  it.each([
    { ...rules, package: { label: 'box', size: 1, priceCents: 12000 } },
    { ...rules, package: { label: 'box', size: 10, priceCents: 15001 } },
    { ...rules, bulkTiers: [{ minimumQuantity: 10, unitPriceCents: 1300 }] },
    { ...rules, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1600 }] },
    { ...rules, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }, { minimumQuantity: 5, unitPriceCents: 1200 }] },
    { ...rules, bulkTiers: [{ minimumQuantity: 3, unitPriceCents: 1200 }, { minimumQuantity: 5, unitPriceCents: 1300 }] },
  ])('rejects invalid or conflicting rules %#', (invalid) => {
    expect(() => validatePricingRules(1500, invalid)).toThrow(BadRequestException);
  });
});
