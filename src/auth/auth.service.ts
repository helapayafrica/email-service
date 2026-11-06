import { UserService } from '../users/user.service.js';
import { hashPassword, verifyPassword } from '../users/password.js';
import { getSiteConfig } from '../config/sites.config.js';
import type { LoginDto } from './dto/login.dto.js';
import { JwtService } from '@nestjs/jwt';
import { Injectable, Logger } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { JwTPayload } from './jwt-payload.js';


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // When the email doesn't exist we still run one hash verification, so
  // "unknown email" and "wrong password" take the same time and attackers
  // can't use response time to discover which emails have accounts.
  private readonly dummyHash = hashPassword('not-a-real-password-timing-only');

  constructor(
    private readonly users: UserService,
  private readonly jwt: JwtService,
) {}

async login(dto: LoginDto) {
  const user = await this.users.findByEmailWithPassword(dto.email);
  const passwordValid = await verifyPassword(
    user?.passwordHash ?? (await this.dummyHash),
    dto.password,
  );

  // Same message for every failure so it doesn't revealwhich part was wrong.
  if (!user || !user.isActive || !passwordValid) {
    this.logger.warn('Login failed');
    throw new UnauthorizedException('Invalid email orpassword');
  }

  const payload: JwTPayload = {
    sub: user.id,
    siteId: user.siteId,
    email: user.email,
  };
  const accessToken = await this.jwt.signAsync(payload);
  this.logger.log(`Login succeeded userId=${user.id}siteId=${user.siteId}`);

  return {
    accessToken,
    tokenType: 'Bearer' as const,
    expiresIn: Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600),
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      siteId: user.siteId,
      siteName: getSiteConfig(user.siteId)?.name ?? user.siteId,
    },
  };
}
}