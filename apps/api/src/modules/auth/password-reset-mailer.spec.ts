import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordResetMailer } from './password-reset-mailer.js';

describe('PasswordResetMailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires configured email delivery', async () => {
    const config = { get: vi.fn(() => undefined) } as unknown as ConfigService;
    const mailer = new PasswordResetMailer(config);

    await expect(mailer.send({
      email: 'ama@example.com',
      fullName: 'Ama Boateng',
      resetUrl: 'https://stockledger.example/reset-password?token=secret',
      expiresInMinutes: 30,
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends the reset message through the configured Resend account', async () => {
    const get = vi.fn((key: string) => ({
      'email.resendApiKey': 're_test_key',
      'email.from': 'StockLedger <accounts@example.com>',
    })[key]);
    const config = { get } as unknown as ConfigService;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const mailer = new PasswordResetMailer(config);

    await mailer.send({
      email: 'ama@example.com',
      fullName: 'Ama <Boateng>',
      resetUrl: 'https://stockledger.example/reset-password?token=secret&next=<unsafe>',
      expiresInMinutes: 30,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers).toEqual({ Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json' });
    const body = JSON.parse(options.body as string) as { to: string[]; html: string };
    expect(body.to).toEqual(['ama@example.com']);
    expect(body.html).toContain('Ama &lt;Boateng&gt;');
    expect(body.html).not.toContain('<unsafe>');
  });
});
