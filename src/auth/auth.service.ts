import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../users/user.service.js';
import { hashPassword, verifyPassword } from '../users/password.js';
import { SitesService } from '../sites/sites.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { JwtPayload } from './jwt-payload.js';
import type { AuthUser } from './auth-user.js';

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
    private readonly sites: SitesService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const passwordValid = await verifyPassword(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );

    // Same message for every failure so it doesn't reveal which part was wrong.
    if (!user || !user.isActive || !passwordValid) {
      this.logger.warn('Login failed');
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload);
    this.logger.log(`Login succeeded userId=${user.id} role=${user.role}`);

    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600),
      user: await this.profile({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        siteIds: user.siteIds,
      }),
    };
  }

  // What the dashboard gets: who you are, plus the companies you can switch between.
  async profile(user: AuthUser) {
    const siteIds = await this.sites.accessibleSiteIds(user);
    const names = await this.sites.namesById(siteIds);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sites: siteIds.map((id) => ({ id, name: names.get(id) ?? id })),
    };
  }
}
