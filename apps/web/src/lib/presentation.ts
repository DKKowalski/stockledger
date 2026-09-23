import type { LocationType, MovementType, UserRole } from '../types';

export const roleLabel: Record<UserRole, string> = {
  administrator: 'Administrator',
  inventory_manager: 'Inventory manager',
  shop_attendant: 'Shop attendant',
};

export const placeLabel: Record<LocationType, string> = {
  warehouse: 'Warehouse',
  shop: 'Shop',
};

export const movementMeta: Record<MovementType, { label: string; hint: string }> = {
  purchase: { label: 'Purchase', hint: 'Goods received into a place' },
  transfer: { label: 'Transfer', hint: 'Move stock from one place to another' },
  return_in: { label: 'Return in', hint: 'Goods returned into a place' },
  return_out: { label: 'Return to supplier', hint: 'Goods sent back to the supplier' },
  damage: { label: 'Damaged stock', hint: 'Stock written off as damaged' },
  sale: { label: 'Sale', hint: 'Goods sold at a shop' },
};

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

export const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${date}T00:00:00`));

export const joinedOn = (value: string) =>
  new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
