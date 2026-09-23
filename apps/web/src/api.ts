import type { LocationType, LoginResponse, MovementType, Place, Snapshot, User, UserRole } from './types';

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
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(message ?? `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (body: { email: string; password: string }) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  profile: (accessToken: string) => request<User>('/auth/me', undefined, accessToken),
  users: (accessToken: string) => request<User[]>('/auth/users', undefined, accessToken),
  addUser: (accessToken: string, body: { fullName: string; email: string; password: string; role: Exclude<UserRole, 'administrator'>; locationId?: string }) =>
    request<User>('/auth/users', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  snapshot: (accessToken: string, days: number, locationId?: string | null) =>
    request<Snapshot>(`/inventory/snapshot?days=${days}${locationId ? `&locationId=${locationId}` : ''}`, undefined, accessToken),
  addLocation: (accessToken: string, body: { name: string; type: LocationType }) =>
    request<Place>('/inventory/locations', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  addItem: (accessToken: string, body: Record<string, string | number>) =>
    request('/inventory/items', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  addMovement: (accessToken: string, body: { itemId: string; locationId: string; destinationLocationId?: string; type: MovementType; quantity: number; movementDate: string; reference?: string; note?: string }) =>
    request('/inventory/movements', { method: 'POST', body: JSON.stringify(body) }, accessToken),
  deleteMovement: (accessToken: string, id: string) =>
    request(`/inventory/movements/${id}`, { method: 'DELETE' }, accessToken),
};
