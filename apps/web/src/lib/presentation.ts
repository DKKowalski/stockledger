import type { Currency, LocationType, MovementType, UserRole } from '../types';

const currencyLocale: Record<Currency, string> = {
  GHS: 'en-GH',
  USD: 'en-US',
  NGN: 'en-NG',
  GBP: 'en-GB',
  EUR: 'en-IE',
};

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
  return_in: { label: 'Customer return', hint: 'Return stock against its original sale' },
  return_out: { label: 'Return to supplier', hint: 'Goods sent back to the supplier' },
  damage: { label: 'Damaged stock', hint: 'Stock written off as damaged' },
  sale: { label: 'Sale', hint: 'Goods sold at a shop' },
  adjustment_in: { label: 'Count adjustment in', hint: 'Stock added after a physical count' },
  adjustment_out: { label: 'Count adjustment out', hint: 'Stock removed after a physical count' },
};

export const formatMoney = (cents: number, currency: Currency) =>
  new Intl.NumberFormat(currencyLocale[currency], {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
