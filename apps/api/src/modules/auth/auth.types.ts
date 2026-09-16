import type { Request } from 'express';

export type UserRole = 'administrator' | 'inventory_manager';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}
