export type MovementType = 'purchase' | 'transfer' | 'return_in' | 'return_out' | 'damage' | 'sale' | 'adjustment_in' | 'adjustment_out';
export type UserRole = 'administrator' | 'inventory_manager' | 'shop_attendant';
export type LocationType = 'warehouse' | 'shop';
export type User = {
  id: string;
  companyId: string;
  locationId: string | null;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  setupPending: boolean;
  createdAt: string;
};
export type LoginResponse = { accessToken: string; user: User };
export type RegistrationResponse = { verificationRequired: true; email: string };
export type AccountAccessLink = { url: string; expiresAt: string };
export type CreateUserResponse = { user: User; invitation: AccountAccessLink | null };
export type BusinessType = 'retail' | 'wholesale' | 'warehouse' | 'mixed';
export type InventorySource = 'spreadsheet' | 'another_system' | 'paper' | 'starting_fresh';
export type Currency = 'GHS' | 'USD' | 'NGN' | 'GBP' | 'EUR';
export type TimeZone = 'Africa/Accra' | 'Africa/Lagos' | 'Europe/London' | 'America/New_York' | 'UTC';
export type DateFormat = 'day_month_year' | 'month_day_year' | 'year_month_day';
export type CompanySettings = {
  id: string;
  name: string;
  businessType: BusinessType;
  contactEmail: string;
  phone: string;
  address: string;
  currency: Currency;
  timeZone: TimeZone;
  dateFormat: DateFormat;
};
export type ActivityEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
};
export type OnboardingStatus = {
  company: {
    id: string;
    name: string;
    businessType: BusinessType | null;
    inventorySource: InventorySource | null;
  };
  completed: boolean;
  completedAt: string | null;
  counts: { locations: number; items: number; movements: number; teammates: number };
};
export type Item = {
  id: string; sku: string; name: string; category: string; unit: string;
  reorderLevel: number; unitCostCents: number; sellingPriceCents: number | null;
  isActive: boolean;
  createdAt: string; updatedAt: string;
};
export type Place = { id: string; name: string; type: LocationType };
export type Position = {
  item: Item; location: Place; opening: number; purchases: number; returnsIn: number;
  transferredIn: number; transferredOut: number; returnsOut: number; damaged: number; sales: number;
  adjustmentsIn: number; adjustmentsOut: number;
  closing: number; valueCents: number; outLastPeriod: number; lastOutDate: string | null;
  isLowStock: boolean; velocity: 'fast' | 'slow' | 'dead' | 'none';
};
export type Movement = {
  id: string; itemId: string; locationId: string; destinationLocationId: string | null;
  type: MovementType; quantity: number; movementDate: string; reference: string | null;
  unitPriceCents: number | null; saleTotalCents: number | null;
  unitCostCents: number | null; costTotalCents: number | null;
  supplierId: string | null; relatedMovementId: string | null; stockCountId: string | null;
  note: string | null; createdAt: string; item: Item | null;
  location: Place | null; destination: Place | null; sign: 1 | -1;
};
export type Snapshot = {
  periodDays: number; generatedAt: string; locationId: string | null;
  locations: Place[];
  items: Item[];
  summary: { closingUnits: number; stockValueCents: number; lowStockItems: number; damagedUnits: number; deadStockLines: number };
  positions: Position[]; movements: Movement[]; periodMovements: Movement[];
};

export type Supplier = {
  id: string; companyId: string; name: string; email: string | null; phone: string | null;
  address: string | null; isActive: boolean; createdAt: string; updatedAt: string;
};

export type StockCount = {
  id: string; companyId: string; itemId: string; locationId: string; countedByUserId: string;
  expectedQuantity: number; countedQuantity: number; varianceQuantity: number; unitCostCents: number;
  countedAt: string; note: string | null; createdAt: string; item: Item | null; location: Place | null;
};

export type Profitability = {
  periodDays: number; startDate: string; endDate: string; locationId: string | null;
  locationType: LocationType | null; itemId: string | null; category: string | null;
  summary: {
    netSalesCents: number; costedRevenueCents: number; cogsCents: number; grossProfitCents: number;
    marginPercent: number | null; inventoryLossCents: number; costCoveragePercent: number;
    unitsSold: number; unitsReturned: number;
  };
  lines: Array<{
    itemId: string; itemName: string; locationId: string; locationName: string;
    unitsSold: number; unitsReturned: number; netSalesCents: number; costedRevenueCents: number;
    cogsCents: number; grossProfitCents: number; marginPercent: number | null; uncostedSaleUnits: number;
  }>;
  trend: Array<{ date: string; netSalesCents: number; grossProfitCents: number }>;
};

export type ProfitabilityFilters = {
  days: number;
  locationType?: LocationType;
  locationId?: string;
  category?: string;
  itemId?: string;
};
