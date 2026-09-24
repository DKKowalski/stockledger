import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
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
}
