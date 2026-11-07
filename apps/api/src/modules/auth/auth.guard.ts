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

    let payload: AccessTokenPayload;
    try { payload = await this.jwt.verifyAsync<AccessTokenPayload>(token); }
    catch { throw new UnauthorizedException('Your session has expired'); }
    // Infrastructure failures must propagate as server errors, not invalid credentials.
    const user = await this.prisma.withCompany(payload.companyId, async (tx) => {
      if (payload.sid) {
        const session = await tx.orm.public.RefreshSession.first({ id: payload.sid, companyId: payload.companyId, userId: payload.sub });
        if (!session || new Date(session.expiresAt).getTime() <= Date.now()) throw new UnauthorizedException('Your session has expired');
      }
      // Old signed tokens remain compatible until their original expiry. Every
      // login and refresh after deployment issues a session-bound token.
      return tx.orm.public.User.first({ id: payload.sub, companyId: payload.companyId });
    });
    if (!user || user.isActive === false || user.role !== payload.role) throw new UnauthorizedException('Your session has expired');
    request.user = payload;
    return true;
  }

  private bearerToken(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
