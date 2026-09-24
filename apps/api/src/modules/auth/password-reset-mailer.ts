import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PasswordResetMessage = {
  email: string;
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
};

@Injectable()
export class PasswordResetMailer {
  constructor(private readonly config: ConfigService) {}

  async send(message: PasswordResetMessage) {
    const apiKey = this.config.get<string>('email.resendApiKey');
    const from = this.config.get<string>('email.from');
    if (!apiKey || !from) {
      throw new ServiceUnavailableException('Password reset email is not configured');
    }

    const fullName = escapeHtml(message.fullName);
    const resetUrl = escapeHtml(message.resetUrl);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.email],
        subject: 'Reset your StockLedger password',
        text: `Hello ${message.fullName},\n\nAn administrator requested a password reset for your StockLedger account. Open this link within ${message.expiresInMinutes} minutes:\n\n${message.resetUrl}\n\nIf you were not expecting this email, contact your administrator.`,
        html: `<div style="background:#f0f0eb;padding:32px 18px;font-family:Arial,sans-serif;color:#11120f"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d9dcd2;border-radius:16px;padding:28px"><p style="margin:0 0 18px;font-size:18px;font-weight:700">StockLedger</p><h1 style="margin:0;font-size:28px;line-height:1.15">Reset your password</h1><p style="margin:18px 0 0;color:#51544d;line-height:1.55">Hello ${fullName}, an administrator requested a password reset for your account.</p><p style="margin:24px 0"><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#11120f;color:#fff;text-decoration:none;font-weight:600">Choose a new password</a></p><p style="margin:0;color:#7a7e75;font-size:13px;line-height:1.5">This link expires in ${message.expiresInMinutes} minutes. If you were not expecting it, contact your administrator.</p></div></div>`,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException('The reset email could not be sent. Try again shortly.');
    }
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
}
