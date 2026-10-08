import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ResetPasswordDto } from './reset-password.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const generatedToken = '31000000-0000-4000-8000-000000000001.' + 'a'.repeat(64);

describe('password reset validation', () => {
  it('accepts the opaque token format issued by the auth service', async () => {
    await expect(pipe.transform({
      token: generatedToken,
      newPassword: 'FreshPassword123!',
    }, { type: 'body', metatype: ResetPasswordDto })).resolves.toMatchObject({ token: generatedToken });
  });

  it('rejects tokens beyond the shared opaque-token limit', async () => {
    await expect(pipe.transform({
      token: 'a'.repeat(161),
      newPassword: 'FreshPassword123!',
    }, { type: 'body', metatype: ResetPasswordDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
