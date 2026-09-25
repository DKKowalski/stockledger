export enum StockMovementType {
  PURCHASE = 'purchase',
  TRANSFER = 'transfer',
  RETURN_IN = 'return_in',
  RETURN_OUT = 'return_out',
  DAMAGE = 'damage',
  SALE = 'sale',
  ADJUSTMENT_IN = 'adjustment_in',
  ADJUSTMENT_OUT = 'adjustment_out',
}

export type MovementVelocity = 'fast' | 'slow' | 'dead' | 'none';

export const MOVEMENT_SIGN: Record<StockMovementType, 1 | -1> = {
  purchase: 1,
  return_in: 1,
  transfer: -1,
  return_out: -1,
  damage: -1,
  sale: -1,
  adjustment_in: 1,
  adjustment_out: -1,
};
