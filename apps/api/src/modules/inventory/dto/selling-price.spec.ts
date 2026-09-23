import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateMovementDto } from './create-movement.dto.js';
import { UpdateSellingPriceDto } from './update-selling-price.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

describe('selling price validation', () => {
  it.each([-1, 1.5, 2147483648, null, '100'])('rejects an invalid cents value: %s', async (sellingPriceCents) => {
    await expect(pipe.transform({ sellingPriceCents }, { type: 'body', metatype: UpdateSellingPriceDto }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([0, 175, 2147483647])('accepts integer cents: %s', async (sellingPriceCents) => {
    await expect(pipe.transform({ sellingPriceCents }, { type: 'body', metatype: UpdateSellingPriceDto }))
      .resolves.toMatchObject({ sellingPriceCents });
  });

  it('rejects an attempt to supply the charged price on a sale', async () => {
    await expect(pipe.transform({
      itemId: '51000000-0000-4000-8000-000000000001',
      locationId: '32000000-0000-4000-8000-000000000002',
      type: 'sale', quantity: 1, movementDate: '2026-09-23', unitPriceCents: 1,
    }, { type: 'body', metatype: CreateMovementDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
