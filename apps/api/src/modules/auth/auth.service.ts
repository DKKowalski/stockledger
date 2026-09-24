import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterOwnerDto } from './dto/register-owner.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetAccountStatusDto } from './dto/set-account-status.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { PasswordResetMailer } from './password-reset-mailer.js';
import type { UserRole } from './auth.types.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwordResetMailer: PasswordResetMailer,
  ) {}

  async registerOwner(body: RegisterOwnerDto) {
    const email = body.email.trim().toLowerCase();
    const existing = await this.prisma.client.orm.public.User.first({
      email: email as Varchar<255>,
    });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await this.prisma.client.transaction(async (tx) => {
      const company = await tx.orm.public.Company.create({
        name: body.businessName.trim() as Varchar<120>,
      });
      return tx.orm.public.User.create({
        companyId: company.id,
        locationId: null,
        fullName: body.fullName.trim() as Varchar<120>,
        email: email as Varchar<255>,
        passwordHash: passwordHash as Varchar<255>,
        role: 'administrator',
      });
    });

    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      user: this.publicUser(user),
    };
  }

  async login(credentials: LoginDto) {
    const email = credentials.email.trim().toLowerCase();
    const user = await this.prisma.client.orm.public.User.first({
      email: email as Varchar<255>,
    });

    if (!user || !(await argon2.verify(user.passwordHash, credentials.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.isActive === false) {
      throw new ForbiddenException('This account has been deactivated. Contact your administrator.');
    }

    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      user: this.publicUser(user),
    };
  }

  async profile(userId: string) {
    const user = await this.prisma.client.orm.public.User.first({ id: userId });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return this.publicUser(user);
  }

  async updateProfile(userId: string, body: UpdateProfileDto) {
    const user = await this.account(userId);
    const fullName = body.fullName.trim();
    const email = body.email.trim().toLowerCase();
    if (!fullName) throw new BadRequestException('Enter your full name');

    const existing = await this.prisma.client.orm.public.User.first({
      email: email as Varchar<255>,
    });
    if (existing && existing.id !== user.id) {
      throw new ConflictException('An account with this email already exists');
    }

    await this.prisma.client.orm.public.User.where({ id: user.id }).update({
      fullName: fullName as Varchar<120>,
      email: email as Varchar<255>,
    });
    return this.profile(user.id);
  }

  async changePassword(userId: string, body: ChangePasswordDto) {
    const user = await this.account(userId);
    this.assertAdministrator(user.role);
    if (!(await argon2.verify(user.passwordHash, body.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (await argon2.verify(user.passwordHash, body.newPassword)) {
      throw new BadRequestException('Choose a password you have not used for this account');
    }

    const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
    await this.prisma.client.orm.public.User.where({ id: user.id }).update({
      passwordHash: passwordHash as Varchar<255>,
    });
    return { changed: true };
  }

  async setAccountStatus(userId: string, targetUserId: string, body: SetAccountStatusDto) {
    const actor = await this.account(userId);
    this.assertAdministrator(actor.role);
    const target = await this.companyUser(actor.companyId, targetUserId);
    if (target.role === 'administrator') {
      throw new BadRequestException('Administrator accounts cannot be deactivated here');
    }

    await this.prisma.client.orm.public.User.where({ id: target.id }).update({
      isActive: body.isActive,
      ...(body.isActive ? {} : {
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      }),
    });
    return this.publicUser({ ...target, isActive: body.isActive });
  }

  async requestPasswordReset(userId: string, targetUserId: string) {
    const actor = await this.account(userId);
    this.assertAdministrator(actor.role);
    const target = await this.companyUser(actor.companyId, targetUserId);
    if (target.role === 'administrator') {
      throw new BadRequestException('Administrators change their password from account settings');
    }
    if (target.isActive === false) {
      throw new BadRequestException('Activate this account before sending a password reset');
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(token);
    const expiresInMinutes = this.config.getOrThrow<number>('auth.passwordResetTtlMinutes');
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    await this.prisma.client.orm.public.User.where({ id: target.id }).update({
      passwordResetTokenHash: tokenHash as Varchar<64>,
      passwordResetExpiresAt: expiresAt,
    });

    try {
      const webOrigin = this.config.getOrThrow<string>('app.webOrigin').replace(/\/$/, '');
      await this.passwordResetMailer.send({
        email: target.email,
        fullName: target.fullName,
        resetUrl: `${webOrigin}/reset-password?token=${token}`,
        expiresInMinutes,
      });
    } catch (error) {
      await this.prisma.client.orm.public.User.where({
        id: target.id,
        passwordResetTokenHash: tokenHash as Varchar<64>,
      }).update({
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      });
      throw error;
    }

    return { sent: true };
  }

  async resetPassword(body: ResetPasswordDto) {
    const tokenHash = this.hashResetToken(body.token);
    const user = await this.prisma.client.orm.public.User.first({
      passwordResetTokenHash: tokenHash as Varchar<64>,
    });
    if (!user || user.isActive === false || !user.passwordResetExpiresAt || new Date(user.passwordResetExpiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
    if (await argon2.verify(user.passwordHash, body.newPassword)) {
      throw new BadRequestException('Choose a password you have not used for this account');
    }

    const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
    await this.prisma.client.orm.public.User.where({
      id: user.id,
      passwordResetTokenHash: tokenHash as Varchar<64>,
    }).update({
      passwordHash: passwordHash as Varchar<255>,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    });
    return { changed: true };
  }

  async listUsers(userId: string) {
    const actor = await this.account(userId);
    this.assertAdministrator(actor.role);
    const users = await this.prisma.client.orm.public.User.where({ companyId: actor.companyId }).all();
    return users
      .map((user) => this.publicUser(user))
      .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.email.localeCompare(right.email));
  }

  async createUser(userId: string, body: CreateUserDto) {
    const actor = await this.account(userId);
    this.assertAdministrator(actor.role);
    const email = body.email.trim().toLowerCase();
    const existing = await this.prisma.client.orm.public.User.first({
      email: email as Varchar<255>,
    });
    if (existing) throw new ConflictException('An account with this email already exists');

    const locationId = await this.assignedLocation(actor.companyId, body);
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await this.prisma.client.orm.public.User.create({
      companyId: actor.companyId,
      locationId,
      fullName: body.fullName.trim() as Varchar<120>,
      email: email as Varchar<255>,
      passwordHash: passwordHash as Varchar<255>,
      role: body.role,
    });
    return this.publicUser(user);
  }

  private async account(userId: string) {
    const user = await this.prisma.client.orm.public.User.first({ id: userId });
    if (!user || user.isActive === false) throw new UnauthorizedException('Account is not available');
    return user;
  }

  private async companyUser(companyId: string, userId: string) {
    const user = await this.prisma.client.orm.public.User.first({ id: userId, companyId });
    if (!user) throw new NotFoundException('Account not found');
    return user;
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async assignedLocation(companyId: string, body: CreateUserDto) {
    if (body.role === 'inventory_manager') {
      if (body.locationId) throw new BadRequestException('An inventory manager works across every place');
      return null;
    }
    if (!body.locationId) throw new BadRequestException('Choose the shop this attendant will use');
    const location = await this.prisma.client.orm.public.Location.first({ id: body.locationId });
    if (!location || location.companyId !== companyId) throw new NotFoundException('Shop not found');
    if (location.type !== 'shop') throw new BadRequestException('A shop attendant must be assigned to a shop');
    return body.locationId;
  }

  private assertAdministrator(role: UserRole) {
    if (role !== 'administrator') {
      throw new ForbiddenException('Only an administrator can manage accounts');
    }
  }

  private publicUser(user: {
    id: string;
    companyId: string;
    locationId: string | null;
    fullName: string;
    email: string;
    role: string;
    isActive?: boolean;
    createdAt: string;
  }) {
    return {
      id: user.id,
      companyId: user.companyId,
      locationId: user.locationId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive ?? true,
      createdAt: user.createdAt,
    };
  }
}
