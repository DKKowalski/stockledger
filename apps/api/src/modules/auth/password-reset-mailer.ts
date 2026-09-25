import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PasswordResetMessage = {
  email: string;
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
};

type AccountLinkMessage = {
  email: string;
  fullName: string;
  url: string;
  expiresInHours: number;
};

@Injectable()
export class PasswordResetMailer {
  constructor(private readonly config: ConfigService) {}

  async send(message: PasswordResetMessage) {
    return this.deliver({
      email: message.email,
      subject: 'Reset your StockLedger password',
      text: `Hello ${message.fullName},\n\nAn administrator requested a password reset for your StockLedger account. Open this link within ${message.expiresInMinutes} minutes:\n\n${message.resetUrl}\n\nIf you were not expecting this email, contact your administrator.`,
      heading: 'Reset your password',
      introduction: `Hello ${message.fullName}, an administrator requested a password reset for your account.`,
      buttonLabel: 'Choose a new password',
      url: message.resetUrl,
      footnote: `This link expires in ${message.expiresInMinutes} minutes. If you were not expecting it, contact your administrator.`,
    });
  }

  async sendRecovery(message: PasswordResetMessage) {
    return this.deliver({
      email: message.email,
      subject: 'Reset your StockLedger password',
      text: `Hello ${message.fullName},\n\nWe received a request to reset your StockLedger password. Open this link within ${message.expiresInMinutes} minutes:\n\n${message.resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      heading: 'Reset your password',
      introduction: `Hello ${message.fullName}, use the secure link below to choose a new password.`,
      buttonLabel: 'Choose a new password',
      url: message.resetUrl,
      footnote: `This link expires in ${message.expiresInMinutes} minutes and can only be used once. If you did not request it, you can ignore this email.`,
    });
  }

  async sendVerification(message: AccountLinkMessage) {
    return this.deliver({
      email: message.email,
      subject: 'Verify your StockLedger email',
      text: `Hello ${message.fullName},\n\nVerify your email to finish creating your StockLedger workspace. This link expires in ${message.expiresInHours} hours:\n\n${message.url}`,
      heading: 'Verify your email',
      introduction: `Hello ${message.fullName}, confirm this email address to open your new workspace.`,
      buttonLabel: 'Verify email',
      url: message.url,
      footnote: `This link expires in ${message.expiresInHours} hours.`,
    });
  }

  async sendInvitation(message: AccountLinkMessage) {
    return this.deliver({
      email: message.email,
      subject: 'You are invited to StockLedger',
      text: `Hello ${message.fullName},\n\nYour administrator invited you to StockLedger. Create your password within ${message.expiresInHours} hours:\n\n${message.url}`,
      heading: 'Join your team',
      introduction: `Hello ${message.fullName}, your StockLedger account is ready. Choose your own password to get started.`,
      buttonLabel: 'Accept invitation',
      url: message.url,
      footnote: `This invitation expires in ${message.expiresInHours} hours.`,
    });
  }

  private async deliver(message: {
    email: string;
    subject: string;
    text: string;
    heading: string;
    introduction: string;
    buttonLabel: string;
    url: string;
    footnote: string;
  }) {
    const apiKey = this.config.get<string>('email.resendApiKey');
    const from = this.config.get<string>('email.from');
    if (!apiKey || !from) {
      throw new ServiceUnavailableException('Account email delivery is not configured');
    }

    const heading = escapeHtml(message.heading);
    const introduction = escapeHtml(message.introduction);
    const buttonLabel = escapeHtml(message.buttonLabel);
    const url = escapeHtml(message.url);
    const footnote = escapeHtml(message.footnote);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.email],
        subject: message.subject,
        text: message.text,
        html: `<div style="background:#f0f0eb;padding:32px 18px;font-family:Arial,sans-serif;color:#11120f"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d9dcd2;border-radius:16px;padding:28px"><p style="margin:0 0 18px;font-size:18px;font-weight:700">StockLedger</p><h1 style="margin:0;font-size:28px;line-height:1.15">${heading}</h1><p style="margin:18px 0 0;color:#51544d;line-height:1.55">${introduction}</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#11120f;color:#fff;text-decoration:none;font-weight:600">${buttonLabel}</a></p><p style="margin:0;color:#7a7e75;font-size:13px;line-height:1.5">${footnote}</p></div></div>`,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException('The account email could not be sent. Try again shortly.');
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
