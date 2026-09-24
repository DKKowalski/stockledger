import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerToken(request);

    if (!token) throw new UnauthorizedException('Sign in to continue');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      const user = await this.prisma.client.orm.public.User.first({ id: payload.sub });
      if (!user || user.isActive === false) throw new Error('Account unavailable');
      request.user = payload;
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
