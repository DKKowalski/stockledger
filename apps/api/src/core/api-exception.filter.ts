import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Sentry } from './monitoring.js';

type HttpErrorBody = { message?: string | string[] };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = randomUUID();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      const detail = exception instanceof Error ? exception.stack ?? exception.message : String(exception);
      this.logger.error(`${request.method} ${request.originalUrl} failed [${requestId}]`, detail);
      Sentry.withScope((scope) => {
        scope.setTag('request_id', requestId);
        scope.setTag('http.method', request.method);
        scope.setTag('http.route', request.originalUrl);
        const rawCloudflareRay = request.headers?.['cf-ray'];
        const cloudflareRay = Array.isArray(rawCloudflareRay) ? rawCloudflareRay[0] : rawCloudflareRay;
        if (cloudflareRay) scope.setTag('cloudflare.ray_id', cloudflareRay);
        Sentry.captureException(exception);
      });
    }

    response.setHeader('X-Request-Id', requestId);
    response.status(status).json({
      statusCode: status,
      code: status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`,
      message: status >= 500
        ? 'We could not complete that request right now.'
        : this.httpMessage(exception),
      requestId,
    });
  }

  private httpMessage(exception: unknown) {
    if (!(exception instanceof HttpException)) return 'The request could not be completed.';
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    const message = (body as HttpErrorBody).message;
    return Array.isArray(message) ? message.join('. ') : message ?? exception.message;
  }
}
