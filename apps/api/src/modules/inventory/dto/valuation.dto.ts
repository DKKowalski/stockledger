import { IsObject, IsUUID } from 'class-validator';
import { z } from 'zod';

const integer = z.number().int().min(0).max(2147483647);
const common = {
  itemId: z.string().uuid().transform((v) => v.toLowerCase()),
  expectedItemUpdatedAt: z.string().min(1).max(80),
  expectedUnit: z.string().min(1).max(20),
  expectedCurrency: z.string().regex(/^[A-Z]{3}$/),
  expectedQuantity: integer,
  expectedSequence: integer,
  reference: z.string().trim().min(1).max(200),
  confirmed: z.literal(true),
};
export const valuationInput = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('checkpoint'), valueCents: integer, costReviewId: z.string().uuid().nullable(), freeStockConfirmed: z.boolean() }).strict(),
  z.object({ ...common, kind: z.literal('receipt'), locationId: z.string().uuid().transform(v => v.toLowerCase()), quantity: integer.min(1), unitCostCents: integer,
    movementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Use a valid purchase date'),
    freeStockConfirmed: z.boolean(), supplierId: z.string().uuid().nullable().transform(v => v?.toLowerCase() ?? null) }).strict(),
  z.object({ ...common, kind:z.literal('stock_operation'),operation:z.enum(['transfer','damage','count','supplier_return','receipt_reversal']),
    locationId:z.string().uuid().transform(v=>v.toLowerCase()),destinationLocationId:z.string().uuid().nullable().transform(v=>v?.toLowerCase()??null),
    quantity:integer,expectedLocationQuantity:integer,unitCostCents:integer.nullable(),freeStockConfirmed:z.boolean(),
    originalMovementId:z.string().uuid().nullable().transform(v=>v?.toLowerCase()??null),supplierCreditCents:integer.nullable(),reason:z.string().trim().min(1).max(200),
    movementDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Use a valid date'),
  }).strict(),
  z.object({ ...common, kind: z.literal('value_adjustment'), valueCents: integer, reason: z.string().trim().min(1).max(200), freeStockConfirmed: z.boolean() }).strict(),
]).superRefine((input, context) => {
  if (input.kind === 'receipt' && Number.isSafeInteger(input.quantity) && Number.isSafeInteger(input.unitCostCents) && BigInt(input.quantity) * BigInt(input.unitCostCents) > 2147483647n) {
    context.addIssue({code:z.ZodIssueCode.custom,path:['unitCostCents'],message:'The purchase total exceeds 2147483647 cents'});
  }
});
export type ValuationInput = z.infer<typeof valuationInput>;
export class PrepareValuationDto {
  @IsUUID() requestKey!: string;
  @IsObject() input!: Record<string, unknown>;
}
