import { BadRequestException, ConflictException } from '@nestjs/common';
export type OriginalPortion = {
  movementId: string;
  itemId: string;
  quantity: number;
  returned: number;
  unitPriceCents: number | null;
  unitCostCents: number | null;
};
export type ReturnChoice = { itemId: string; quantity: number; disposition: 'resellable' | 'damaged' };
export function returnAmount(value: bigint) {
  if (value < 0n || value > 2147483647n)
    throw new BadRequestException('The return quantity or amount exceeds the supported limit');
  return Number(value);
}
export function allocateReturn(portions: readonly OriginalPortion[], choices: readonly ReturnChoice[]) {
  if (!choices.length || new Set(choices.map((c) => c.itemId)).size !== choices.length)
    throw new BadRequestException('Choose each return item once');
  const result = [];
  for (const choice of choices) {
    if (!Number.isInteger(choice.quantity) || choice.quantity < 1 || choice.quantity > 2147483647)
      throw new BadRequestException('Enter a whole return quantity');
    let remaining = choice.quantity;
    for (const part of portions.filter((p) => p.itemId === choice.itemId)) {
      if (!Number.isInteger(part.returned) || part.returned < 0 || part.returned > part.quantity)
        throw new ConflictException('Original return quantities do not reconcile');
      const quantity = Math.min(remaining, part.quantity - part.returned);
      if (!quantity) continue;
      if (part.unitPriceCents === null || part.unitCostCents === null)
        throw new ConflictException(
          'The original price or acquisition cost was not recorded. No historical cost can be invented',
        );
      const refundCents = returnAmount(BigInt(quantity) * BigInt(part.unitPriceCents));
      const cogsCents = returnAmount(BigInt(quantity) * BigInt(part.unitCostCents));
      result.push({
        originalMovementId: part.movementId,
        itemId: part.itemId,
        quantity,
        unitPriceCents: part.unitPriceCents,
        unitCostCents: part.unitCostCents,
        refundCents,
        cogsCents,
        disposition: choice.disposition,
      });
      remaining -= quantity;
      if (!remaining) break;
    }
    if (remaining)
      throw new ConflictException('The requested quantity exceeds the remaining returnable units');
  }
  return {
    allocations: result,
    refundCents: returnAmount(result.reduce((s, p) => s + BigInt(p.refundCents), 0n)),
    cogsCents: returnAmount(result.reduce((s, p) => s + BigInt(p.cogsCents), 0n)),
  };
}
