import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { returnInput } from './return.dto.js';
import { valuationInput } from './valuation.dto.js';

const validReturn = () => ({ sourceType:'legacy',sourceId:randomUUID().toUpperCase(),kind:'return',expectedRevision:'a'.repeat(64),movementDate:'2026-11-07',reason:'Customer return',reference:'Receipt 1',confirmed:true,lines:[{itemId:randomUUID().toUpperCase(),quantity:1,disposition:'resellable'}] });
describe('validation contracts after Zod security upgrade', () => {
  it('retains UUID normalization and rejects unknown money fields', () => {
    const input = validReturn(), parsed = returnInput.parse(input);
    expect(parsed.sourceId).toBe(input.sourceId.toLowerCase());
    expect(parsed.lines[0]!.itemId).toBe(input.lines[0]!.itemId.toLowerCase());
    expect(returnInput.safeParse({...input,refundCents:1}).success).toBe(false);
  });
  it('rejects oversized return collections, fractional units and invalid calendar dates', () => {
    const input=validReturn();
    for (const changed of [{lines:Array.from({length:101},()=>input.lines[0])},{lines:[{...input.lines[0],quantity:1.5}]},{movementDate:'2026-02-30'}]) expect(returnInput.safeParse({...input,...changed}).success).toBe(false);
  });
  it('preserves the purchase overflow check without rounding or coercing strings', () => {
    const input={itemId:randomUUID(),expectedItemUpdatedAt:'2026-11-07',expectedUnit:'pcs',expectedCurrency:'GHS',expectedQuantity:0,expectedSequence:0,reference:'Receipt',confirmed:true,kind:'receipt',locationId:randomUUID(),quantity:2,unitCostCents:100,movementDate:'2026-11-07',freeStockConfirmed:false,supplierId:null};
    expect(valuationInput.safeParse(input).success).toBe(true);
    expect(valuationInput.safeParse({...input,unitCostCents:2147483647}).success).toBe(false);
    expect(valuationInput.safeParse({...input,quantity:'2'}).success).toBe(false);
  });
});
