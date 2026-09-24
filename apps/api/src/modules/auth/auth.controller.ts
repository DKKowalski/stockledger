import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterOwnerDto } from './dto/register-owner.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetAccountStatusDto } from './dto/set-account-status.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Post('register')
  register(@Body() body: RegisterOwnerDto) {
    return this.auth.registerOwner(body);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  profile(@Req() request: AuthenticatedRequest) {
    return this.auth.profile(request.user.sub);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  updateProfile(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    return this.auth.updateProfile(request.user.sub, body);
  }

  @Patch('me/password')
  @UseGuards(AuthGuard)
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(request.user.sub, body);
  }

  @Get('users')
  @UseGuards(AuthGuard)
  listUsers(@Req() request: AuthenticatedRequest) {
    return this.auth.listUsers(request.user.sub);
  }

  @Post('users')
  @UseGuards(AuthGuard)
  createUser(@Req() request: AuthenticatedRequest, @Body() body: CreateUserDto) {
    return this.auth.createUser(request.user.sub, body);
  }

  @Patch('users/:id/status')
  @UseGuards(AuthGuard)
  setAccountStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
    @Body() body: SetAccountStatusDto,
  ) {
    return this.auth.setAccountStatus(request.user.sub, targetUserId, body);
  }

  @Post('users/:id/password-reset')
  @UseGuards(AuthGuard)
  requestPasswordReset(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) targetUserId: string,
  ) {
    return this.auth.requestPasswordReset(request.user.sub, targetUserId);
  }
}
