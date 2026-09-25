import type { ActivityEvent, BusinessType, CompanySettings, InventorySource, LocationType, LoginResponse, MovementType, OnboardingStatus, Place, RegistrationResponse, Snapshot, User, UserRole } from './types';

export type DataExportType = 'inventory' | 'movements' | 'activity';

const base = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
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
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(message ?? `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

async function download(path: string, accessToken: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(message ?? `Download failed (${response.status})`, response.status);
  }
  const disposition = response.headers.get('Content-Disposition');
  const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'stockledger-export.csv';
  return { blob: await response.blob(), filename };
}

export const api = {
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
  addUser: (accessToken: string, body: { fullName: string; email: string; role: Exclude<UserRole, 'administrator'>; locationId?: string }) =>
    request<User>('/auth/users', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  setUserStatus: (accessToken: string, userId: string, isActive: boolean) =>
    request<User>(`/auth/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }, accessToken),
  sendPasswordReset: (accessToken: string, userId: string) =>
    request<{ sent: true }>(`/auth/users/${userId}/password-reset`, { method: 'POST' }, accessToken),
  resendInvitation: (accessToken: string, userId: string) =>
    request<{ sent: true }>(`/auth/users/${userId}/invitation`, { method: 'POST' }, accessToken),
  onboardingStatus: (accessToken: string) =>
    request<OnboardingStatus>('/onboarding', undefined, accessToken),
  setBusinessType: (accessToken: string, businessType: BusinessType) =>
    request<OnboardingStatus>('/onboarding/business-type', { method: 'PATCH', body: JSON.stringify({ businessType }) }, accessToken),
  setInventorySource: (accessToken: string, inventorySource: InventorySource) =>
    request<OnboardingStatus>('/onboarding/inventory-source', { method: 'PATCH', body: JSON.stringify({ inventorySource }) }, accessToken),
  completeOnboarding: (accessToken: string) =>
    request<OnboardingStatus>('/onboarding/complete', { method: 'POST' }, accessToken),
  companySettings: (accessToken: string) => request<CompanySettings>('/settings', undefined, accessToken),
  updateCompanySettings: (accessToken: string, body: Omit<CompanySettings, 'id'>) =>
    request<CompanySettings>('/settings', { method: 'PATCH', body: JSON.stringify(body) }, accessToken),
  activity: (accessToken: string) => request<ActivityEvent[]>('/settings/activity', undefined, accessToken),
  exportData: (accessToken: string, type: DataExportType) => download(`/settings/exports/${type}`, accessToken),
  snapshot: (accessToken: string, days: number, locationId?: string | null) =>
    request<Snapshot>(`/inventory/snapshot?days=${days}${locationId ? `&locationId=${locationId}` : ''}`, undefined, accessToken),
  addLocation: (accessToken: string, body: { name: string; type: LocationType }) =>
    request<Place>('/inventory/locations', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  addItem: (accessToken: string, body: Record<string, string | number>) =>
    request('/inventory/items', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  importItems: (accessToken: string, body: { locationId: string; rows: Array<Record<string, string | number>> }) =>
    request<{ imported: number }>('/inventory/items/import', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  updateSellingPrice: (accessToken: string, itemId: string, sellingPriceCents: number) =>
    request(`/inventory/items/${itemId}/selling-price`, { method: 'PATCH', body: JSON.stringify({ sellingPriceCents }) }, accessToken),
  addMovement: (accessToken: string, body: { itemId: string; locationId: string; destinationLocationId?: string; type: MovementType; quantity: number; movementDate: string; reference?: string; note?: string; expectedUnitPriceCents?: number }) =>
    request('/inventory/movements', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  deleteMovement: (accessToken: string, id: string) =>
    request(`/inventory/movements/${id}`, { method: 'DELETE' }, accessToken),
};
