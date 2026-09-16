import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerToken(request);

    if (!token) throw new UnauthorizedException('Sign in to continue');

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Your session has expired');
    }
  }

  private bearerToken(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
