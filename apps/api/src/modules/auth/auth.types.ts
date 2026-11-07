import type { Request } from 'express';

export type UserRole = 'administrator' | 'inventory_manager' | 'shop_attendant';

export interface AccessTokenPayload {
  sub: string;
  companyId: string;
  role: UserRole;
  // Optional for compatibility with access tokens issued before session binding.
  sid?: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}
