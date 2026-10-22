import { CallHandler, ExecutionContext, ForbiddenException, Injectable, type NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../modules/auth/auth.types.js';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Price calculators use POST for their input but never write, so demo visitors can try them.
const READ_ONLY_POSTS = new Set(['/inventory/pricing-preview/quote', '/inventory/sales/quote']);

@Injectable()
export class DemoProtectionInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const demoCompanyId = this.config.get<string>('app.demoCompanyId');

    if (
      demoCompanyId
      && request.user?.companyId === demoCompanyId
      && !READ_ONLY_METHODS.has(request.method)
      && !(request.method === 'POST' && READ_ONLY_POSTS.has(request.path))
    ) {
      throw new ForbiddenException('This demo is read-only. Create a workspace to save changes.');
    }

    return next.handle();
  }
}
