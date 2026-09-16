import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(credentials: LoginDto) {
    const email = credentials.email.trim().toLowerCase();
    const user = await this.prisma.client.orm.public.User.first({
      email: email as Varchar<255>,
    });

    if (!user || !(await argon2.verify(user.passwordHash, credentials.password))) {
      throw new UnauthorizedException('Invalid email or password');
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

  private publicUser(user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    createdAt: string;
  }) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
