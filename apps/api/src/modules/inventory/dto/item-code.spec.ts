import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateItemDto } from './create-item.dto.js';
import { ImportItemsDto } from './import-items.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const item = {
  name: 'Basmati Rice 5kg',
  category: 'Grocery',
  unit: 'bag',
  reorderLevel: 10,
  unitCostCents: 1250,
  openingStock: 20,
};

describe('optional item codes', () => {
  it('accepts a manually created item without a code', async () => {
    await expect(pipe.transform({
      ...item,
      locationId: '32000000-0000-4000-8000-000000000001',
    }, { type: 'body', metatype: CreateItemDto })).resolves.toMatchObject({ name: item.name });
  });

  it('accepts spreadsheet rows without item codes', async () => {
    await expect(pipe.transform({
      locationId: '32000000-0000-4000-8000-000000000001',
      rows: [item],
    }, { type: 'body', metatype: ImportItemsDto })).resolves.toMatchObject({ rows: [{ name: item.name }] });
  });

  it('still rejects an invalid supplied item code', async () => {
    await expect(pipe.transform({
      ...item,
      sku: 'not valid!',
      locationId: '32000000-0000-4000-8000-000000000001',
    }, { type: 'body', metatype: CreateItemDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
