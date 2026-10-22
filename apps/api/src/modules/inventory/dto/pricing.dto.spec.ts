import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PricingQuoteDto, UpdatePricingDto } from './pricing.dto.js';
import { CreateMovementDto } from './create-movement.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const itemId = '51000000-0000-4000-8000-000000000001';
const valid = { expectedVersion: 0, previewEnabled: true, baseUnit: 'pcs', baseUnitVerified: true,
  package: { label: 'box', size: 10, priceCents: 12000 }, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300 }] };

describe('pricing preview request validation', () => {
  it('accepts validated integer prices and explicit base-unit verification', async () => {
    await expect(pipe.transform(valid, { type: 'body', metatype: UpdatePricingDto })).resolves.toMatchObject(valid);
  });
  it.each([
    { ...valid, baseUnitVerified: false }, { ...valid, expectedVersion: -1 },
    { ...valid, package: [] }, { ...valid, bulkTiers: [[]] },
    { ...valid, package: { ...valid.package, size: 1 } },
    { ...valid, package: { ...valid.package, priceCents: '12000' } },
    { ...valid, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1.5 }] },
    { ...valid, bulkTiers: [{ minimumQuantity: 5, unitPriceCents: 1300, override: true }] },
  ])('rejects malformed configurations %#', async (body) => {
    await expect(pipe.transform(body, { type: 'body', metatype: UpdatePricingDto })).rejects.toBeInstanceOf(BadRequestException);
  });
  // Each row wraps its lines array: it.each spreads a bare array row into separate arguments.
  it.each<[unknown[]]>([[[]], [[{ itemId, quantity: 0 }]], [[{ itemId, quantity: 1.5 }]],
    [[{ itemId, quantity: 1, manualDiscountCents: 100 }]], [[{ itemId, quantity: 1, quantityUnit: 'carton' }]]])(
    'rejects invalid quote inputs %#', async (lines) => {
      await expect(pipe.transform({ lines }, { type: 'body', metatype: PricingQuoteDto })).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('continues rejecting discounts and price overrides on the existing sale endpoint', async () => {
    await expect(pipe.transform({ itemId, locationId: '32000000-0000-4000-8000-000000000002',
      type: 'sale', quantity: 1, movementDate: '2026-10-20', discountCents: 100,
    }, { type: 'body', metatype: CreateMovementDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
