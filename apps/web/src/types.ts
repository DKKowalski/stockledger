export type MovementType = 'purchase' | 'transfer' | 'return_in' | 'return_out' | 'damage';
export type UserRole = 'administrator' | 'inventory_manager';
export type User = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  createdAt: string;
};
export type LoginResponse = { accessToken: string; user: User };
export type Item = {
  id: string; sku: string; name: string; category: string; unit: string;
  reorderLevel: number; unitCostCents: number; openingStock: number;
  createdAt: string; updatedAt: string;
};
export type Position = {
  item: Item; opening: number; purchases: number; returnsIn: number;
  transferred: number; returnsOut: number; damaged: number; closing: number;
  valueCents: number; outLastPeriod: number; lastOutDate: string | null;
  isLowStock: boolean; velocity: 'fast' | 'slow' | 'dead' | 'none';
};
export type Movement = {
  id: string; itemId: string; type: MovementType; quantity: number;
  movementDate: string; reference: string | null; note: string | null;
  createdAt: string; item: Item | null; sign: 1 | -1;
};
export type Snapshot = {
  periodDays: number; generatedAt: string;
  summary: { closingUnits: number; stockValueCents: number; lowStockItems: number; damagedUnits: number; deadStockLines: number };
  positions: Position[]; movements: Movement[];
};
