import { Body, Controller, ForbiddenException, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { minutes, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterOwnerDto } from './dto/register-owner.dto.js';
import { RequestVerificationDto } from './dto/request-verification.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetAccountStatusDto } from './dto/set-account-status.dto.js';
import { AcceptInvitationDto, TokenDto } from './dto/token.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: minutes(1), blockDuration: minutes(5) } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(response, await this.auth.login(body));
  }

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: minutes(60), blockDuration: minutes(60) } })
  register(@Body() body: RegisterOwnerDto) {
    return this.auth.registerOwner(body);
  }

  @Post('email/verify')
  @Throttle({ default: { limit: 6, ttl: minutes(15), blockDuration: minutes(15) } })
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: TokenDto, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(response, await this.auth.verifyEmail(body));
  }

  @Post('email/resend')
  @Throttle({ default: { limit: 3, ttl: minutes(60), blockDuration: minutes(30) } })
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() body: RequestVerificationDto) {
    return this.auth.resendVerification(body);
  }

  @Post('invitations/accept')
  @Throttle({ default: { limit: 6, ttl: minutes(15), blockDuration: minutes(15) } })
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(@Body() body: AcceptInvitationDto, @Res({ passthrough: true }) response: Response) {
    return this.withRefreshCookie(response, await this.auth.acceptInvitation(body));
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: minutes(1), blockDuration: minutes(2) } })
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    return this.withRefreshCookie(response, await this.auth.refresh(this.refreshCookie(request)));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertTrustedOrigin(request);
    const result = await this.auth.logout(this.refreshCookie(request));
    response.clearCookie('stockledger_refresh', this.cookieOptions());
    return result;
  }

  @Post('password/reset')
  @Throttle({ default: { limit: 5, ttl: minutes(15), blockDuration: minutes(30) } })
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body);
  }

  @Post('password/forgot')
  @Throttle({ default: { limit: 5, ttl: minutes(15), blockDuration: minutes(30) } })
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  profile(@Req() request: AuthenticatedRequest) {
    return this.auth.profile(request.user.sub, request.user.companyId);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  updateProfile(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    return this.auth.updateProfile(request.user.sub, request.user.companyId, body);
  }

  @Patch('me/password')
  @UseGuards(AuthGuard)
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(request.user.sub, request.user.companyId, body);
  }

  @Get('users')
  @UseGuards(AuthGuard)
  listUsers(@Req() request: AuthenticatedRequest) {
    return this.auth.listUsers(request.user.sub, request.user.companyId);
  }

  @Post('users')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthGuard)
  createUser(@Req() request: AuthenticatedRequest, @Body() body: CreateUserDto) {
    return this.auth.createUser(request.user.sub, request.user.companyId, body);
  }

  @Patch('users/:id/status')
  @UseGuards(AuthGuard)
  setAccountStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @Body() body: SetAccountStatusDto,
  ) {
    return this.auth.setAccountStatus(request.user.sub, request.user.companyId, targetUserId, body);
  }

  @Post('users/:id/password-reset')
  @Throttle({ default: { limit: 5, ttl: minutes(15), blockDuration: minutes(15) } })
  @UseGuards(AuthGuard)
  requestPasswordReset(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
  ) {
    return this.auth.requestPasswordReset(request.user.sub, request.user.companyId, targetUserId);
  }

  @Post('users/:id/password-reset-link')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: minutes(15), blockDuration: minutes(15) } })
  @UseGuards(AuthGuard)
  createPasswordResetLink(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
  ) {
    return this.auth.createPasswordResetLink(request.user.sub, request.user.companyId, targetUserId);
  }

  @Post('users/:id/invitation')
  @Throttle({ default: { limit: 5, ttl: minutes(15), blockDuration: minutes(15) } })
  @UseGuards(AuthGuard)
  resendInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
  ) {
    return this.auth.resendInvitation(request.user.sub, request.user.companyId, targetUserId);
  }

  @Post('users/:id/invitation-link')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: minutes(15), blockDuration: minutes(15) } })
  @UseGuards(AuthGuard)
  createInvitationLink(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
  ) {
    return this.auth.createInvitationLink(request.user.sub, request.user.companyId, targetUserId);
  }

  private withRefreshCookie<T extends { refreshToken: string }>(response: Response, session: T) {
    response.cookie('stockledger_refresh', session.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.config.getOrThrow<number>('auth.refreshTokenTtlDays') * 24 * 60 * 60 * 1000,
    });
    const { refreshToken: _refreshToken, ...publicSession } = session;
    return publicSession;
  }

  private cookieOptions() {
    const production = this.config.getOrThrow<string>('app.environment') === 'production';
    return {
      httpOnly: true,
      secure: production,
      sameSite: production ? 'none' as const : 'lax' as const,
      path: '/auth',
    };
  }

  private refreshCookie(request: Request) {
    const cookie = request.headers.cookie?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('stockledger_refresh='));
    return cookie ? decodeURIComponent(cookie.slice('stockledger_refresh='.length)) : undefined;
  }

  private assertTrustedOrigin(request: Request) {
    const origin = request.headers.origin;
    if (origin && origin !== this.config.getOrThrow<string>('app.webOrigin').replace(/\/$/, '')) {
      throw new ForbiddenException('Request origin is not allowed');
    }
  }
}
