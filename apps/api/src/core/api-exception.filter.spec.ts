import { BadRequestException, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  const status = vi.fn();
  const json = vi.fn();
  const setHeader = vi.fn();
  const response = { status, json, setHeader };
  const request = { method: 'GET', originalUrl: '/inventory/snapshot' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    vi.clearAllMocks();
    status.mockReturnValue(response);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('keeps useful client errors', () => {
    new ApiExceptionFilter().catch(new BadRequestException('Choose the original sale'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'HTTP_400',
      message: 'Choose the original sale',
      requestId: expect.any(String),
    }));
  });

  it('logs unexpected failures without returning their details', () => {
    new ApiExceptionFilter().catch(new Error('database password appeared here'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'INTERNAL_ERROR',
      message: 'We could not complete that request right now.',
      requestId: expect.any(String),
    }));
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toContain('database password');
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
