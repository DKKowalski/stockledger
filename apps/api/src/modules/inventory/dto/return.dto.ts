import { IsObject, IsUUID } from 'class-validator';
import { z } from 'zod';
export const returnInput = z
  .object({
    sourceType: z.enum(['grouped', 'legacy']),
    sourceId: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    kind: z.enum(['return', 'reversal']),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    movementDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
        'Use a valid date',
      ),
    reason: z.string().trim().min(1).max(200),
    reference: z.string().trim().min(1).max(200),
    confirmed: z.literal(true),
    lines: z
      .array(
        z
          .object({
            itemId: z
              .string()
              .uuid()
              .transform((v) => v.toLowerCase()),
            quantity: z.number().int().min(1).max(2147483647),
            disposition: z.enum(['resellable', 'damaged']),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ReturnInput = z.infer<typeof returnInput>;
export class PrepareReturnDto {
  @IsUUID() requestKey!: string;
  @IsObject() input!: Record<string, unknown>;
}
