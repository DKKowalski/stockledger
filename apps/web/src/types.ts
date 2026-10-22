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
  isDemo: boolean;
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
  defaultLocationId: string | null;
  defaultUnit: string;
  defaultReorderLevel: number;
  skuPrefix: string;
  nextSkuNumber: number;
  allowNegativeStock: boolean;
  requirePurchaseSource: boolean;
  requireAdjustmentReason: boolean;
  hybridPricingEnabled: boolean;
  shopTerm: 'shop' | 'branch' | 'outlet' | 'store';
  warehouseTerm: 'warehouse' | 'stockroom';
  itemTerm: 'item' | 'product' | 'material';
};
export type InventorySettings = Pick<CompanySettings, 'defaultLocationId' | 'defaultUnit' | 'defaultReorderLevel' | 'skuPrefix' | 'nextSkuNumber' | 'allowNegativeStock' | 'requirePurchaseSource' | 'requireAdjustmentReason' | 'hybridPricingEnabled'>;
export type TerminologySettings = Pick<CompanySettings, 'shopTerm' | 'warehouseTerm' | 'itemTerm'>;
export type CompanyProfileSettings = Pick<CompanySettings, 'name' | 'businessType' | 'contactEmail' | 'phone' | 'address' | 'currency' | 'timeZone' | 'dateFormat'>;
export type ActivityEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
};
export type SecurityOverview = {
  sessions: Array<{ id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean }>;
  recentSignIns: Array<{ id: string; createdAt: string; user: { id: string; fullName: string; email: string } | null; userAgent: string | null; ipAddress: string | null }>;
};
export type DataSummary = {
  lastExport: { type: string; rowCount: number; createdAt: string; actorName: string } | null;
  imports: Array<{ id: string; fileName: string | null; imported: number; createdAt: string; actorName: string }>;
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
  preciseCosting?: boolean;
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
  saleId?: string; saleLineId?: string; pricingCategory?: 'retail' | 'bulk' | 'box';
  id: string; itemId: string; locationId: string; destinationLocationId: string | null;
  type: MovementType; quantity: number; movementDate: string; reference: string | null;
  unitPriceCents: number | null; saleTotalCents: number | null;
  unitCostCents: number | null; costTotalCents: number | null;
  supplierId: string | null; relatedMovementId: string | null; stockCountId: string | null;
  note: string | null; createdAt: string; item: Item | null;
  location: Place | null; destination: Place | null; sign: 1 | -1;
};
export type MovementLedger = { movements: Movement[]; total: number; offset: number; limit: number };
export type ReturnableSale = Movement & { returnableQuantity: number };
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
  expectedQuantity: number; countedQuantity: number; varianceQuantity: number; unitCostCents: number; valueImpactCents?: number;
  countedAt: string; note: string | null; createdAt: string; item: Item | null; location: Place | null;
};

export type Profitability = {
  periodDays: number; startDate: string; endDate: string; locationId: string | null;
  locationType: LocationType | null; itemId: string | null; category: string | null;
  summary: {
    netSalesCents: number; discountsGivenCents: number; fullPriceSalesCents: number; costedRevenueCents: number; cogsCents: number; grossProfitCents: number;
    marginPercent: number | null; inventoryLossCents: number; costCoveragePercent: number;
    unitsSold: number; unitsReturned: number;
  };
  lines: Array<{
    itemId: string; itemName: string; locationId: string; locationName: string;
    unitsSold: number; unitsReturned: number; netSalesCents: number; costedRevenueCents: number;
    cogsCents: number; grossProfitCents: number; marginPercent: number | null; uncostedSaleUnits: number; discountCents: number;
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

export type PricingVersion = {
  id: string; companyId: string; itemId: string; version: number; baseUnit: string; previewEnabled: boolean;
  packageLabel: string | null; packageSize: number | null; packagePriceCents: number | null;
  bulkTiers: Array<{ minimumQuantity: number; unitPriceCents: number }>;
  createdByUserId: string; createdAt: string;
};
export type PricingPreviewConfiguration = { available: boolean; previewOnly: true; configuration: PricingVersion | null };
export type PricingPreviewInput = {
  expectedVersion: number; previewEnabled: boolean; baseUnit: string; baseUnitVerified: boolean;
  package: { label: string; size: number; priceCents: number } | null;
  bulkTiers: Array<{ minimumQuantity: number; unitPriceCents: number }>;
};
export type PricingQuote = {
  previewOnly: true; canComplete: false; currency: string;
  grossSalesCents: number; automaticDiscountCents: number; totalCents: number;
  lines: Array<{
    itemId: string; itemName: string; baseUnit: string; quantity: number; packageCount: number;
    retailPriceCents: number; pricingVersion: number | null; configurationVersion: number;
    package: { label: string; size: number; priceCents: number } | null;
    priceDropQuantities: number[];
    grossSalesCents: number; automaticDiscountCents: number; totalCents: number;
    components: Array<{ category: 'retail' | 'bulk' | 'box'; quantity: number; unitPriceCents: number; totalCents: number }>;
  }>;
};

export type SaleQuoteInput = { movementDate: string; lines: Array<{ itemId: string; quantity: number; quantityUnit?: 'base' | 'package'; expectedVersion: number; expectedRetailPriceCents: number }> };
export type SaleQuote = Omit<PricingQuote, 'previewOnly' | 'canComplete' | 'currency'> & { currency: Currency; canComplete: true; developmentOnly: true; quoteToken: string; expiresAt: string; movementDate: string };
export type CompletedSale = {
  id: string; idempotencyKey: string; status: 'completed'; currency: Currency; movementDate: string;
  grossSalesCents: number; automaticDiscountCents: number; totalCents: number;
  lines: Array<{ id: string; itemName: string; baseUnit: string; quantity: number; totalCents: number; components: PricingQuote['lines'][number]['components'] }>;
};

export type CostReviewSource = 'purchase_records' | 'opening_records' | 'free_acquisition';
export type CostReviewInput = {
  expectedCostCents: number; expectedUnit: string; expectedItemUpdatedAt: string; expectedCurrency: Currency;
  source: CostReviewSource; reference: string; confirmed: true;
};
export type CostReview = {
  available: boolean; developmentOnly: true; currency: Currency;
  item: Pick<Item, 'id' | 'name' | 'unit' | 'unitCostCents' | 'updatedAt' | 'isActive'>;
  state: 'unconfirmed' | 'confirmed' | 'changed';
  review: null | {
    id: string; costCents: number; unit: string; itemUpdatedAt: string; source: CostReviewSource; currency?: Currency;
    reference: string; reviewedAt: string; reviewedByUserId: string | null;
  };
};

export type ExactCostInput = {
  itemId: string; kind: 'checkpoint' | 'receipt' | 'value_adjustment' | 'stock_operation'; expectedItemUpdatedAt: string; expectedUnit: string; expectedCurrency: string;
  expectedQuantity: number; expectedSequence: number; reference: string; confirmed: true; freeStockConfirmed: boolean;
  valueCents?: number; costReviewId?: string | null; locationId?: string; quantity?: number; unitCostCents?: number; movementDate?: string; supplierId?: string | null; reason?: string;
};
export type ExactCostState = {
  available: boolean; developmentOnly: true; currency: Currency; allowNegativeStock: boolean; hasNegativePosition: boolean;
  item: CostReview['item']; quantity: number; valueCents: number | null; sequence: number;
  checkpoint: {id: string; reference: string; openingQuantity: number; openingValueCents: number} | null;
  positions: Array<{locationId: string; name: string; quantity: number}>; costReview: CostReview;
};
export type ExactCostRequest = {
  request: {key: string; status: 'prepared' | 'applied' | 'cancelled'; input: ExactCostInput | null; createdAt: string; finishedAt: string | null} | null;
  checkpoint?: {id: string; openingQuantity: number; openingValueCents: number} | null;
  entry?: {id: string; quantityAfter: number; valueAfterCents: number} | null;
};
