import type { ReturnSource,StockState } from './features/movements/hybrid-operations-panels';
import type { OperationRecord } from './features/movements/durable-operation';
import type { ExactCostState, ExactCostInput, ExactCostRequest } from './types';
import type { MovementLedger, ReturnableSale } from './types';
import type { AccountAccessLink, ActivityEvent, BusinessType, CompanyProfileSettings, CompanySettings, CreateUserResponse, DataSummary, InventorySettings, InventorySource, Item, LocationType, LoginResponse, MovementType, OnboardingStatus, Place, Profitability, ProfitabilityFilters, RegistrationResponse, SecurityOverview, Snapshot, StockCount, Supplier, TerminologySettings, User, UserRole } from './types';
import type { SaleQuoteInput, SaleQuote, CompletedSale } from './types';
import type { PricingPreviewConfiguration, PricingPreviewInput, PricingQuote } from './types';
import type { CostReview, CostReviewInput } from './types';

export type DataExportType = 'workspace' | 'workspace-v2' | 'workspace-v3' | 'workspace-v4' | 'workspace-v5' | 'inventory' | 'movements' | 'activity';

const base = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[]; code?: string; requestId?: string } | null;
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(message ?? `Request failed (${response.status})`, response.status, body?.code, body?.requestId ?? response.headers.get('X-Request-Id') ?? undefined);
  }
  return response.json() as Promise<T>;
}

async function download(path: string, accessToken: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[]; code?: string; requestId?: string } | null;
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(message ?? `Download failed (${response.status})`, response.status, body?.code, body?.requestId ?? response.headers.get('X-Request-Id') ?? undefined);
  }
  const disposition = response.headers.get('Content-Disposition');
  const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'stockledger-export.csv';
  return { blob: await response.blob(), filename };
}

export const api = {
  returnSources:(token:string)=>request<{available:boolean;sources:Array<{id:string;type:'grouped'|'legacy';date:string;reference:string}>}>('/inventory/sale-returns',undefined,token),
  returnSource:(token:string,type:string,id:string)=>request<ReturnSource>(`/inventory/sale-returns/sources/${type}/${id}`,undefined,token),
  prepareReturn:(token:string,key:string,input:Record<string,unknown>)=>request<OperationRecord>('/inventory/sale-returns/requests',{method:'POST',body:JSON.stringify({requestKey:key,input})},token),
  returnRequest:(token:string,key:string)=>request<OperationRecord>(`/inventory/sale-returns/requests/${key}`,undefined,token),
  applyReturn:(token:string,key:string)=>request<OperationRecord>(`/inventory/sale-returns/requests/${key}/apply`,{method:'POST'},token),
  cancelReturn:(token:string,key:string)=>request<OperationRecord>(`/inventory/sale-returns/requests/${key}/cancel`,{method:'POST'},token),
  stockOperationStatus:(token:string)=>request<{available:boolean;hasEnrolledItems:boolean}>('/inventory/stock-operations',undefined,token),
  stockOperationItem:(token:string,id:string)=>request<StockState>(`/inventory/items/${id}/stock-operations`,undefined,token),
  exactCostStatus: (token: string) => request<{available: boolean; hasEnrolledItems: boolean}>('/inventory/exact-costing', undefined, token),
  exactCost: (token: string, itemId: string) => request<ExactCostState>(`/inventory/items/${itemId}/exact-costing`, undefined, token),
  prepareExactCost: (token: string, key: string, input: ExactCostInput) => request<ExactCostRequest>('/inventory/exact-costing/requests', {method:'POST',body:JSON.stringify({requestKey:key,input})}, token),
  exactCostRequest: (token: string, key: string) => request<ExactCostRequest>(`/inventory/exact-costing/requests/${key}`, undefined, token),
  applyExactCost: (token: string, key: string) => request<ExactCostRequest>(`/inventory/exact-costing/requests/${key}/apply`, {method:'POST'}, token),
  cancelExactCost: (token: string, key: string) => request<ExactCostRequest>(`/inventory/exact-costing/requests/${key}/cancel`, {method:'POST'}, token),
  costReviewStatus: (accessToken: string) => request<{ available: boolean; developmentOnly: true }>('/inventory/cost-review', undefined, accessToken),
  costReview: (accessToken: string, itemId: string) => request<CostReview>(`/inventory/items/${itemId}/cost-review`, undefined, accessToken),
  confirmCost: (accessToken: string, itemId: string, body: CostReviewInput) => request<CostReview>(`/inventory/items/${itemId}/cost-review`, { method: 'POST', body: JSON.stringify(body) }, accessToken),
  saleCompletionStatus: (accessToken: string) => request<{ available: boolean; developmentOnly: true }>('/inventory/sale-completion', undefined, accessToken),
  saleQuote: (accessToken: string, body: SaleQuoteInput) => request<SaleQuote>('/inventory/sales/quote', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  completeSale: (accessToken: string, body: { idempotencyKey: string; quoteToken: string }) => request<CompletedSale>('/inventory/sales/complete', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  saleByKey: (accessToken: string, key: string) => request<{ sale: CompletedSale | null }>(`/inventory/sales/requests/${key}`, undefined, accessToken),
  pricingPreviewStatus: (accessToken: string) => request<{ available: boolean; previewOnly: true }>('/inventory/pricing-preview', undefined, accessToken),
  pricingPreview: (accessToken: string, itemId: string) => request<PricingPreviewConfiguration>(`/inventory/items/${itemId}/pricing-preview`, undefined, accessToken),
  savePricingPreview: (accessToken: string, itemId: string, body: PricingPreviewInput) =>
    request<PricingPreviewConfiguration>(`/inventory/items/${itemId}/pricing-preview`, { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  quotePricingPreview: (accessToken: string, lines: Array<{ itemId: string; quantity: number; quantityUnit?: 'base' | 'package'; expectedVersion?: number }>) =>
    request<PricingQuote>('/inventory/pricing-preview/quote', { method: 'POST', body: JSON.stringify({ lines }) }, accessToken),
  registerOwner: (body: { fullName: string; businessName: string; email: string; password: string }) =>
    request<RegistrationResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  refresh: () => request<LoginResponse>('/auth/refresh', { method: 'POST' }),
  logout: () => request<{ signedOut: true }>('/auth/logout', { method: 'POST' }),
  verifyEmail: (token: string) => request<LoginResponse>('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: (email: string) => request<{ sent: true }>('/auth/email/resend', { method: 'POST', body: JSON.stringify({ email }) }),
  acceptInvitation: (token: string, newPassword: string) => request<LoginResponse>('/auth/invitations/accept', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
  profile: (accessToken: string) => request<User>('/auth/me', undefined, accessToken),
  updateProfile: (accessToken: string, body: { fullName: string; email: string }) =>
    request<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  changePassword: (accessToken: string, body: { currentPassword: string; newPassword: string }) =>
    request<{ changed: true }>('/auth/me/password', { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  resetPassword: (body: { token: string; newPassword: string }) =>
    request<{ changed: true }>('/auth/password/reset', { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (email: string) =>
    request<{ sent: true }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  users: (accessToken: string) => request<User[]>('/auth/users', undefined, accessToken),
  addUser: (accessToken: string, body: { fullName: string; email: string; role: Exclude<UserRole, 'administrator'>; locationId?: string; delivery: 'email' | 'link' }) =>
    request<CreateUserResponse>('/auth/users', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  setUserStatus: (accessToken: string, userId: string, isActive: boolean) =>
    request<User>(`/auth/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }, accessToken),
  sendPasswordReset: (accessToken: string, userId: string) =>
    request<{ sent: true }>(`/auth/users/${userId}/password-reset`, { method: 'POST' }, accessToken),
  createPasswordResetLink: (accessToken: string, userId: string) =>
    request<AccountAccessLink>(`/auth/users/${userId}/password-reset-link`, { method: 'POST' }, accessToken),
  resendInvitation: (accessToken: string, userId: string) =>
    request<{ sent: true }>(`/auth/users/${userId}/invitation`, { method: 'POST' }, accessToken),
  createInvitationLink: (accessToken: string, userId: string) =>
    request<AccountAccessLink>(`/auth/users/${userId}/invitation-link`, { method: 'POST' }, accessToken),
  securityOverview: (accessToken: string) => request<SecurityOverview>('/auth/security', undefined, accessToken),
  revokeSession: (accessToken: string, sessionId: string) => request<{ revoked: true }>(`/auth/sessions/${sessionId}`, { method: 'DELETE' }, accessToken),
  revokeOtherSessions: (accessToken: string) => request<{ revoked: number }>('/auth/sessions', { method: 'DELETE' }, accessToken),
  transferOwnership: (accessToken: string, targetUserId: string, currentPassword: string) => request<{ transferred: true }>('/auth/ownership-transfer', { method: 'POST', body: JSON.stringify({ targetUserId, currentPassword }) }, accessToken),
  onboardingStatus: (accessToken: string) =>
    request<OnboardingStatus>('/onboarding', undefined, accessToken),
  setBusinessType: (accessToken: string, businessType: BusinessType) =>
    request<OnboardingStatus>('/onboarding/business-type', { method: 'PATCH', body: JSON.stringify({ businessType }) }, accessToken),
  setInventorySource: (accessToken: string, inventorySource: InventorySource) =>
    request<OnboardingStatus>('/onboarding/inventory-source', { method: 'PATCH', body: JSON.stringify({ inventorySource }) }, accessToken),
  completeOnboarding: (accessToken: string) =>
    request<OnboardingStatus>('/onboarding/complete', { method: 'POST' }, accessToken),
  companySettings: (accessToken: string) => request<CompanySettings>('/settings', undefined, accessToken),
  updateCompanySettings: (accessToken: string, body: CompanyProfileSettings) =>
    request<CompanySettings>('/settings', { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  updateInventorySettings: (accessToken: string, body: InventorySettings) =>
    request<CompanySettings>('/settings/inventory', { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  updateTerminologySettings: (accessToken: string, body: TerminologySettings) =>
    request<CompanySettings>('/settings/terminology', { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  activity: (accessToken: string) => request<ActivityEvent[]>('/settings/activity', undefined, accessToken),
  dataSummary: (accessToken: string) => request<DataSummary>('/settings/data-summary', undefined, accessToken),
  exportData: (accessToken: string, type: DataExportType) => download(`/settings/exports/${type}`, accessToken),
  deleteWorkspace: (accessToken: string, body: { currentPassword: string; confirmation: string }) =>
    request<{ deleted: true }>('/settings/account', { method: 'DELETE', body: JSON.stringify(body) }, accessToken),
  snapshot: (accessToken: string, days: number, locationId?: string | null) =>
    request<Snapshot>(`/inventory/snapshot?days=${days}${locationId ? `&locationId=${locationId}` : ''}`, undefined, accessToken),
  addLocation: (accessToken: string, body: { name: string; type: LocationType }) =>
    request<Place>('/inventory/locations', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  addItem: (accessToken: string, body: Record<string, string | number>) =>
    request('/inventory/items', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  updateItem: (accessToken: string, itemId: string, body: Partial<Pick<Item, 'sku' | 'name' | 'category' | 'unit' | 'reorderLevel' | 'unitCostCents' | 'sellingPriceCents' | 'isActive'>>) =>
    request<Item>(`/inventory/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  importItems: (accessToken: string, body: { locationId?: string; fileName?: string; rows: Array<Record<string, string | number>> }) =>
    request<{ imported: number }>('/inventory/items/import', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  updateSellingPrice: (accessToken: string, itemId: string, sellingPriceCents: number) =>
    request(`/inventory/items/${itemId}/selling-price`, { method: 'PATCH', body: JSON.stringify({ sellingPriceCents }) }, accessToken),
  addMovement: (accessToken: string, body: { itemId: string; locationId: string; destinationLocationId?: string; type: MovementType; quantity: number; movementDate: string; reference?: string; note?: string; expectedUnitPriceCents?: number; unitCostCents?: number; supplierId?: string; relatedMovementId?: string }) =>
    request('/inventory/movements', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  movementLedger: (accessToken: string, query: { type?: MovementType; itemId?: string; offset: number; limit: number }) =>
    request<MovementLedger>(`/inventory/movements?${new URLSearchParams({ ...(query.type ? { type: query.type } : {}), ...(query.itemId ? { itemId: query.itemId } : {}), offset: String(query.offset), limit: String(query.limit) })}`, undefined, accessToken),
  returnableSales: (accessToken: string) => request<ReturnableSale[]>('/inventory/movements/returnable-sales', undefined, accessToken),
  deleteMovement: (accessToken: string, id: string) =>
    request(`/inventory/movements/${id}`, { method: 'DELETE' }, accessToken),
  suppliers: (accessToken: string) => request<Supplier[]>('/inventory/suppliers', undefined, accessToken),
  addSupplier: (accessToken: string, body: { name: string; email?: string; phone?: string; address?: string }) =>
    request<Supplier>('/inventory/suppliers', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  updateSupplier: (accessToken: string, supplierId: string, body: Partial<Pick<Supplier, 'name' | 'email' | 'phone' | 'address' | 'isActive'>>) =>
    request<Supplier>(`/inventory/suppliers/${supplierId}`, { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  stockCounts: (accessToken: string) => request<StockCount[]>('/inventory/stock-counts', undefined, accessToken),
  addStockCount: (accessToken: string, body: { itemId: string; locationId: string; countedQuantity: number; countedAt: string; note?: string }) =>
    request<StockCount>('/inventory/stock-counts', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  profitability: (accessToken: string, filters: ProfitabilityFilters) => {
    const params = new URLSearchParams({ days: String(filters.days) });
    if (filters.locationType) params.set('locationType', filters.locationType);
    if (filters.locationId) params.set('locationId', filters.locationId);
    if (filters.category) params.set('category', filters.category);
    if (filters.itemId) params.set('itemId', filters.itemId);
    return request<Profitability>(`/inventory/profitability?${params}`, undefined, accessToken);
  },
};
