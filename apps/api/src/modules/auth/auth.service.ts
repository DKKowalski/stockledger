import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterOwnerDto } from './dto/register-owner.dto.js';
import { RequestVerificationDto } from './dto/request-verification.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetAccountStatusDto } from './dto/set-account-status.dto.js';
import { AcceptInvitationDto, TokenDto } from './dto/token.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { PasswordResetMailer } from './password-reset-mailer.js';
import type { UserRole } from './auth.types.js';

type PublicUserSource = {
  id: string;
  companyId: string;
  locationId: string | null;
  fullName: string;
  email: string;
  role: string;
  isActive?: boolean;
  invitationAcceptedAt?: string | null;
  createdAt: string;
};

type AuthenticationUser = PublicUserSource & {
  passwordHash: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
};

type AuditMetadata = { readonly [key: string]: string | number | boolean | null };

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mailer: PasswordResetMailer,
  ) {}

  async registerOwner(body: RegisterOwnerDto) {
    const email = body.email.trim().toLowerCase();
    if (await this.emailOwner(email)) throw new ConflictException('An account with this email already exists');

    const companyId = randomUUID();
    const verification = this.createOpaqueToken(companyId);
    const expiresInHours = this.config.getOrThrow<number>('auth.emailVerificationTtlHours');
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await this.prisma.withCompany(companyId, async (tx) => {
      const company = await tx.orm.public.Company.create({ id: companyId, name: body.businessName.trim() as Varchar<120> });
      return tx.orm.public.User.create({
        companyId: company.id,
        locationId: null,
        fullName: body.fullName.trim() as Varchar<120>,
        email: email as Varchar<255>,
        passwordHash: passwordHash as Varchar<255>,
        role: 'administrator',
        emailVerificationTokenHash: this.hashToken(verification) as Varchar<64>,
        emailVerificationExpiresAt: this.expiresAt(expiresInHours * 60),
      });
    });

    try {
      await this.mailer.sendVerification({
        email: user.email,
        fullName: user.fullName,
        url: `${this.webOrigin()}/verify-email?token=${encodeURIComponent(verification)}`,
        expiresInHours,
      });
    } catch (error) {
      await this.prisma.withCompany(companyId, async (tx) => {
        await tx.orm.public.User.where({ id: user.id, companyId }).delete();
        await tx.orm.public.Company.where({ id: companyId }).delete();
      });
      throw error;
    }

    return { verificationRequired: true as const, email: user.email };
  }

  async verifyEmail(body: TokenDto) {
    const companyId = this.companyFromToken(body.token, 'verification');
    const tokenHash = this.hashToken(body.token);
    const user = await this.prisma.withCompany(companyId, async (tx) => {
      const account = await tx.orm.public.User.first({ companyId, emailVerificationTokenHash: tokenHash as Varchar<64> });
      if (!account || !account.emailVerificationExpiresAt || new Date(account.emailVerificationExpiresAt).getTime() <= Date.now()) {
        throw new BadRequestException('This verification link is invalid or has expired');
      }
      const verifiedAt = new Date().toISOString();
      await tx.orm.public.User.where({ id: account.id, companyId }).update({
        emailVerifiedAt: verifiedAt,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      });
      await this.audit(tx, companyId, account.id, 'owner.email_verified', 'user', account.id, {});
      return { ...account, emailVerifiedAt: verifiedAt };
    });
    return this.createSession(user);
  }

  async resendVerification(body: RequestVerificationDto) {
    const user = await this.authenticationUser(body.email.trim().toLowerCase());
    if (!user || user.role !== 'administrator' || user.emailVerifiedAt) return { sent: true as const };
    const token = this.createOpaqueToken(user.companyId);
    const tokenHash = this.hashToken(token);
    const expiresInHours = this.config.getOrThrow<number>('auth.emailVerificationTtlHours');
    await this.prisma.withCompany(user.companyId, async (tx) => {
      await tx.orm.public.User.where({ id: user.id, companyId: user.companyId }).update({
        emailVerificationTokenHash: tokenHash as Varchar<64>,
        emailVerificationExpiresAt: this.expiresAt(expiresInHours * 60),
      });
    });
    try {
      await this.mailer.sendVerification({
        email: user.email,
        fullName: user.fullName,
        url: `${this.webOrigin()}/verify-email?token=${encodeURIComponent(token)}`,
        expiresInHours,
      });
    } catch (error) {
      await this.prisma.withCompany(user.companyId, async (tx) => {
        await tx.orm.public.User.where({ id: user.id, companyId: user.companyId, emailVerificationTokenHash: tokenHash as Varchar<64> }).update({
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        });
      });
      throw error;
    }
    return { sent: true as const };
  }

  async login(credentials: LoginDto) {
    const user = await this.authenticationUser(credentials.email.trim().toLowerCase());
    const passwordMatches = await argon2.verify(user?.passwordHash ?? await this.dummyPasswordHash, credentials.password);
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated. Contact your administrator.');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Verify your email before signing in.');
    if (user.role !== 'administrator' && !user.invitationAcceptedAt) throw new ForbiddenException('Accept your invitation before signing in.');
    return this.createSession(user);
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Your session has expired');
    const companyId = this.companyFromToken(refreshToken, 'session');
    const tokenHash = this.hashToken(refreshToken);
    const nextToken = this.createOpaqueToken(companyId);
    const expiresAt = this.expiresAt(this.config.getOrThrow<number>('auth.refreshTokenTtlDays') * 24 * 60);

    return this.prisma.withCompany(companyId, async (tx) => {
      const consumed = await tx.query(this.prisma.client.raw.sql`
        DELETE FROM public.refresh_sessions
        WHERE company_id = ${companyId}::uuid
          AND token_hash = ${tokenHash}
          AND expires_at > now()
        RETURNING user_id
      `.returnsRow({ user_id: 'pg/uuid@1' }).build());
      const userId = consumed[0]?.user_id;
      if (!userId) throw new UnauthorizedException('Your session has expired');
      const user = await this.account(tx, companyId, userId);
      await tx.orm.public.RefreshSession.create({
        companyId,
        userId,
        tokenHash: this.hashToken(nextToken) as Varchar<64>,
        expiresAt,
      });
      return { accessToken: await this.signAccessToken(user), refreshToken: nextToken, user: this.publicUser(user) };
    });
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return { signedOut: true as const };
    const companyId = this.tryCompanyFromToken(refreshToken);
    if (!companyId) return { signedOut: true as const };
    await this.prisma.withCompany(companyId, async (tx) => {
      await tx.orm.public.RefreshSession.where({ companyId, tokenHash: this.hashToken(refreshToken) as Varchar<64> }).delete();
    });
    return { signedOut: true as const };
  }

  async profile(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => this.publicUser(await this.account(tx, companyId, userId)));
  }

  async updateProfile(userId: string, companyId: string, body: UpdateProfileDto) {
    const fullName = body.fullName.trim();
    const email = body.email.trim().toLowerCase();
    if (!fullName) throw new BadRequestException('Enter your full name');
    const emailOwnerId = await this.emailOwner(email);
    if (emailOwnerId && emailOwnerId !== userId) throw new ConflictException('An account with this email already exists');

    return this.prisma.withCompany(companyId, async (tx) => {
      const user = await this.account(tx, companyId, userId);
      await tx.orm.public.User.where({ id: user.id, companyId }).update({ fullName: fullName as Varchar<120>, email: email as Varchar<255> });
      await this.audit(tx, companyId, user.id, 'account.profile_updated', 'user', user.id, { emailChanged: user.email !== email });
      const updated = await tx.orm.public.User.first({ id: user.id, companyId });
      if (!updated) throw new UnauthorizedException('Account no longer exists');
      return this.publicUser(updated);
    });
  }

  async changePassword(userId: string, companyId: string, body: ChangePasswordDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const user = await this.account(tx, companyId, userId);
      this.assertAdministrator(user.role);
      if (!(await argon2.verify(user.passwordHash, body.currentPassword))) throw new BadRequestException('Current password is incorrect');
      if (await argon2.verify(user.passwordHash, body.newPassword)) throw new BadRequestException('Choose a password you have not used for this account');
      const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
      await tx.orm.public.User.where({ id: user.id, companyId }).update({ passwordHash: passwordHash as Varchar<255> });
      await tx.orm.public.RefreshSession.where({ companyId, userId: user.id }).delete();
      await this.audit(tx, companyId, user.id, 'account.password_changed', 'user', user.id, {});
      return { changed: true as const };
    });
  }

  async setAccountStatus(userId: string, companyId: string, targetUserId: string, body: SetAccountStatusDto) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      this.assertAdministrator(actor.role);
      const target = await this.companyUser(tx, companyId, targetUserId);
      if (target.role === 'administrator') throw new BadRequestException('Administrator accounts cannot be deactivated here');
      await tx.orm.public.User.where({ id: target.id, companyId }).update({
        isActive: body.isActive,
        ...(body.isActive ? {} : { passwordResetTokenHash: null, passwordResetExpiresAt: null }),
      });
      if (!body.isActive) await tx.orm.public.RefreshSession.where({ companyId, userId: target.id }).delete();
      await this.audit(tx, companyId, actor.id, body.isActive ? 'account.activated' : 'account.deactivated', 'user', target.id, {});
      return this.publicUser({ ...target, isActive: body.isActive });
    });
  }

  async requestPasswordReset(userId: string, companyId: string, targetUserId: string) {
    const token = this.createOpaqueToken(companyId);
    const tokenHash = this.hashToken(token);
    const expiresInMinutes = this.config.getOrThrow<number>('auth.passwordResetTtlMinutes');
    const target = await this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      this.assertAdministrator(actor.role);
      const companyUser = await this.companyUser(tx, companyId, targetUserId);
      if (companyUser.role === 'administrator') throw new BadRequestException('Administrators change their password from account settings');
      if (!companyUser.isActive) throw new BadRequestException('Activate this account before sending a password reset');
      if (!companyUser.invitationAcceptedAt) throw new BadRequestException('This person must accept their invitation first');
      await tx.orm.public.User.where({ id: companyUser.id, companyId }).update({
        passwordResetTokenHash: tokenHash as Varchar<64>,
        passwordResetExpiresAt: this.expiresAt(expiresInMinutes),
      });
      await this.audit(tx, companyId, actor.id, 'account.password_reset_requested', 'user', companyUser.id, {});
      return companyUser;
    });

    try {
      await this.mailer.send({
        email: target.email,
        fullName: target.fullName,
        resetUrl: `${this.webOrigin()}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes,
      });
    } catch (error) {
      await this.prisma.withCompany(companyId, async (tx) => {
        await tx.orm.public.User.where({ id: target.id, companyId, passwordResetTokenHash: tokenHash as Varchar<64> }).update({
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        });
      });
      throw error;
    }
    return { sent: true as const };
  }

  async resetPassword(body: ResetPasswordDto) {
    const tokenHash = this.hashToken(body.token);
    const companyId = this.tryCompanyFromToken(body.token) ?? await this.companyForResetToken(tokenHash);
    if (!companyId) throw new BadRequestException('This reset link is invalid or has expired');
    return this.prisma.withCompany(companyId, async (tx) => {
      const user = await tx.orm.public.User.first({ companyId, passwordResetTokenHash: tokenHash as Varchar<64> });
      if (!user || !user.isActive || !user.passwordResetExpiresAt || new Date(user.passwordResetExpiresAt).getTime() <= Date.now()) {
        throw new BadRequestException('This reset link is invalid or has expired');
      }
      if (await argon2.verify(user.passwordHash, body.newPassword)) throw new BadRequestException('Choose a password you have not used for this account');
      const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
      await tx.orm.public.User.where({ id: user.id, companyId, passwordResetTokenHash: tokenHash as Varchar<64> }).update({
        passwordHash: passwordHash as Varchar<255>,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      });
      await tx.orm.public.RefreshSession.where({ companyId, userId: user.id }).delete();
      await this.audit(tx, companyId, user.id, 'account.password_reset', 'user', user.id, {});
      return { changed: true as const };
    });
  }

  async listUsers(userId: string, companyId: string) {
    return this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      this.assertAdministrator(actor.role);
      const users = await tx.orm.public.User.where({ companyId }).all();
      return users.map((user) => this.publicUser(user))
        .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.email.localeCompare(right.email));
    });
  }

  async createUser(userId: string, companyId: string, body: CreateUserDto) {
    const email = body.email.trim().toLowerCase();
    if (await this.emailOwner(email)) throw new ConflictException('An account with this email already exists');
    const invitation = this.createOpaqueToken(companyId);
    const expiresInHours = this.config.getOrThrow<number>('auth.invitationTtlHours');
    const unusablePassword = await argon2.hash(randomBytes(48).toString('hex'), { type: argon2.argon2id });
    const user = await this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      this.assertAdministrator(actor.role);
      const locationId = await this.assignedLocation(tx, companyId, body);
      const created = await tx.orm.public.User.create({
        companyId,
        locationId,
        fullName: body.fullName.trim() as Varchar<120>,
        email: email as Varchar<255>,
        passwordHash: unusablePassword as Varchar<255>,
        role: body.role,
        invitationTokenHash: this.hashToken(invitation) as Varchar<64>,
        invitationExpiresAt: this.expiresAt(expiresInHours * 60),
      });
      return created;
    });

    try {
      await this.mailer.sendInvitation({
        email: user.email,
        fullName: user.fullName,
        url: `${this.webOrigin()}/accept-invitation?token=${encodeURIComponent(invitation)}`,
        expiresInHours,
      });
    } catch (error) {
      await this.prisma.withCompany(companyId, async (tx) => {
        await tx.orm.public.User.where({ id: user.id, companyId }).delete();
      });
      throw error;
    }
    await this.prisma.withCompany(companyId, async (tx) => {
      await this.audit(tx, companyId, userId, 'account.invited', 'user', user.id, { role: user.role, locationId: user.locationId });
    });
    return this.publicUser(user);
  }

  async resendInvitation(userId: string, companyId: string, targetUserId: string) {
    const invitation = this.createOpaqueToken(companyId);
    const tokenHash = this.hashToken(invitation);
    const expiresInHours = this.config.getOrThrow<number>('auth.invitationTtlHours');
    const target = await this.prisma.withCompany(companyId, async (tx) => {
      const actor = await this.account(tx, companyId, userId);
      this.assertAdministrator(actor.role);
      const account = await this.companyUser(tx, companyId, targetUserId);
      if (account.role === 'administrator' || account.invitationAcceptedAt) {
        throw new BadRequestException('This account has already completed setup');
      }
      if (!account.isActive) throw new BadRequestException('Activate this account before sending an invitation');
      await tx.orm.public.User.where({ id: account.id, companyId }).update({
        invitationTokenHash: tokenHash as Varchar<64>,
        invitationExpiresAt: this.expiresAt(expiresInHours * 60),
      });
      return account;
    });
    try {
      await this.mailer.sendInvitation({
        email: target.email,
        fullName: target.fullName,
        url: `${this.webOrigin()}/accept-invitation?token=${encodeURIComponent(invitation)}`,
        expiresInHours,
      });
    } catch (error) {
      await this.prisma.withCompany(companyId, async (tx) => {
        await tx.orm.public.User.where({ id: target.id, companyId, invitationTokenHash: tokenHash as Varchar<64> }).update({
          invitationTokenHash: null,
          invitationExpiresAt: null,
        });
      });
      throw error;
    }
    await this.prisma.withCompany(companyId, async (tx) => {
      await this.audit(tx, companyId, userId, 'account.invitation_resent', 'user', target.id, {});
    });
    return { sent: true as const };
  }

  async acceptInvitation(body: AcceptInvitationDto) {
    const companyId = this.companyFromToken(body.token, 'invitation');
    const tokenHash = this.hashToken(body.token);
    const user = await this.prisma.withCompany(companyId, async (tx) => {
      const account = await tx.orm.public.User.first({ companyId, invitationTokenHash: tokenHash as Varchar<64> });
      if (!account || !account.isActive || !account.invitationExpiresAt || new Date(account.invitationExpiresAt).getTime() <= Date.now()) {
        throw new BadRequestException('This invitation is invalid or has expired');
      }
      const passwordHash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
      const acceptedAt = new Date().toISOString();
      await tx.orm.public.User.where({ id: account.id, companyId }).update({
        passwordHash: passwordHash as Varchar<255>,
        emailVerifiedAt: acceptedAt,
        invitationAcceptedAt: acceptedAt,
        invitationTokenHash: null,
        invitationExpiresAt: null,
      });
      await this.audit(tx, companyId, account.id, 'account.invitation_accepted', 'user', account.id, {});
      return { ...account, emailVerifiedAt: acceptedAt, invitationAcceptedAt: acceptedAt };
    });
    return this.createSession(user);
  }

  private async authenticationUser(email: string): Promise<AuthenticationUser | null> {
    const rows = await this.prisma.client.runtime().query(this.prisma.client.raw.sql`
      SELECT id, company_id FROM public.stockledger_auth_user_by_email(${email})
    `.returnsRow({ id: 'pg/uuid@1', company_id: 'pg/uuid@1' }).build());
    const identity = rows[0];
    if (!identity) return null;
    return this.prisma.withCompany(identity.company_id, async (tx) => {
      const user = await tx.orm.public.User.first({ id: identity.id, companyId: identity.company_id });
      return user as AuthenticationUser | null;
    });
  }

  private async emailOwner(email: string) {
    const rows = await this.prisma.client.runtime().query(this.prisma.client.raw.sql`
      SELECT public.stockledger_email_owner(${email}) AS id
    `.returnsRow({ id: 'pg/uuid@1' }).build());
    return rows[0]?.id ?? null;
  }

  private async companyForResetToken(tokenHash: string) {
    const rows = await this.prisma.client.runtime().query(this.prisma.client.raw.sql`
      SELECT public.stockledger_company_for_reset_token(${tokenHash}) AS company_id
    `.returnsRow({ company_id: 'pg/uuid@1' }).build());
    return rows[0]?.company_id ?? null;
  }

  private async account(tx: PrismaTransaction, companyId: string, userId: string) {
    const user = await tx.orm.public.User.first({ id: userId, companyId });
    if (!user || user.isActive === false) throw new UnauthorizedException('Account is not available');
    return user;
  }

  private async companyUser(tx: PrismaTransaction, companyId: string, userId: string) {
    const user = await tx.orm.public.User.first({ id: userId, companyId });
    if (!user) throw new NotFoundException('Account not found');
    return user;
  }

  private async assignedLocation(tx: PrismaTransaction, companyId: string, body: CreateUserDto) {
    if (body.role === 'inventory_manager') {
      if (body.locationId) throw new BadRequestException('An inventory manager works across every place');
      return null;
    }
    if (!body.locationId) throw new BadRequestException('Choose the shop this attendant will use');
    const location = await tx.orm.public.Location.first({ id: body.locationId, companyId });
    if (!location) throw new NotFoundException('Shop not found');
    if (location.type !== 'shop') throw new BadRequestException('A shop attendant must be assigned to a shop');
    return body.locationId;
  }

  private assertAdministrator(role: string) {
    if (role !== 'administrator') throw new ForbiddenException('Only an administrator can manage accounts');
  }

  private async createSession(user: PublicUserSource) {
    const refreshToken = this.createOpaqueToken(user.companyId);
    await this.prisma.withCompany(user.companyId, async (tx) => {
      await tx.orm.public.RefreshSession.create({
        companyId: user.companyId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken) as Varchar<64>,
        expiresAt: this.expiresAt(this.config.getOrThrow<number>('auth.refreshTokenTtlDays') * 24 * 60),
      });
    });
    return { accessToken: await this.signAccessToken(user), refreshToken, user: this.publicUser(user) };
  }

  private signAccessToken(user: PublicUserSource) {
    return this.jwt.signAsync({ sub: user.id, companyId: user.companyId, role: user.role as UserRole });
  }

  private publicUser(user: PublicUserSource) {
    return {
      id: user.id,
      companyId: user.companyId,
      locationId: user.locationId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive ?? true,
      setupPending: user.role !== 'administrator' && !user.invitationAcceptedAt,
      createdAt: user.createdAt,
    };
  }

  private createOpaqueToken(companyId: string) {
    return `${companyId}.${randomBytes(32).toString('hex')}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private companyFromToken(token: string, kind: string) {
    const companyId = this.tryCompanyFromToken(token);
    if (!companyId) throw new BadRequestException(`This ${kind} link is invalid or has expired`);
    return companyId;
  }

  private tryCompanyFromToken(token: string) {
    const companyId = token.split('.', 1)[0] ?? '';
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId) ? companyId : null;
  }

  private expiresAt(minutes: number) {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  private webOrigin() {
    return this.config.getOrThrow<string>('app.webOrigin').replace(/\/$/, '');
  }

  private async audit(
    tx: PrismaTransaction,
    companyId: string,
    actorUserId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: AuditMetadata,
  ) {
    await tx.orm.public.AuditEvent.create({
      companyId,
      actorUserId,
      action: action as Varchar<80>,
      entityType: entityType as Varchar<80>,
      entityId,
      metadata,
    });
  }
}
