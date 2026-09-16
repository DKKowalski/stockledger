export enum StockMovementType {
  PURCHASE = 'purchase',
  TRANSFER = 'transfer',
  RETURN_IN = 'return_in',
  RETURN_OUT = 'return_out',
  DAMAGE = 'damage',
}

export type MovementVelocity = 'fast' | 'slow' | 'dead' | 'none';

export const MOVEMENT_SIGN: Record<StockMovementType, 1 | -1> = {
  purchase: 1,
  return_in: 1,
  transfer: -1,
  return_out: -1,
  damage: -1,
};
