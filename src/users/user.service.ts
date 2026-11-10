import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User, USER_ROLES, type UserRole } from './entities/user.entity.js';
import { isEmail } from 'class-validator';
import { hashPassword } from './password.js';
import { SitesService } from '../sites/sites.service.js';

export const MIN_PASSWORD_LENGTH = 12;

export interface CreateUserInput {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  siteIds: string[];
}

export interface UpdateUserInput {
  fullName?: string;
  role?: UserRole;
  siteIds?: string[];
  isActive?: boolean;
}

// The account as the user who acts on it (no hash; select: false keeps it
// out of every query except login).
export interface ActingUser {
  id: string;
}

function validFullName(value: string): string {
  const fullName = value.trim();
  if (!fullName || fullName.length > 150) {
    throw new BadRequestException('Full name is required (max 150 characters)');
  }
  return fullName;
}

function validRole(role: UserRole): UserRole {
  if (!USER_ROLES.includes(role)) {
    throw new BadRequestException(
      `Role must be one of: ${USER_ROLES.join(', ')}`,
    );
  }
  return role;
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly sites: SitesService,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  // The only query that loads passwordHash; used by login.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo.findOne({
      where: { email: normalizeEmail(email) },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        fullName: true,
        role: true,
        siteIds: true,
        isActive: true,
      },
    });
  }

  async create(input: CreateUserInput): Promise<User> {
    const email = normalizeEmail(input.email);
    if (!isEmail(email)) {
      throw new BadRequestException('Invalid email address');
    }
    const fullName = validFullName(input.fullName);
    const role = validRole(input.role);
    const siteIds = await this.validSiteIds(role, input.siteIds);
    checkPassword(input.password);

    try {
      const saved = await this.repo.save(
        this.repo.create({
          email,
          fullName,
          role,
          siteIds,
          passwordHash: await hashPassword(input.password),
        }),
      );
      // Re-read so the returned object never carries the hash.
      return await this.repo.findOneByOrFail({ id: saved.id });
    } catch (error) {
      // 23505 = Postgres unique_violation (email already taken)
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          `A user with email ${email} already exists`,
        );
      }
      throw error;
    }
  }

  list(): Promise<User[]> {
    return this.repo.find({ order: { email: 'ASC' } });
  }

  async getOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Changes take effect on the user's next request: JwtAuthGuard reloads the
  // user every time. The merged result is validated, so e.g. turning a
  // super-admin into a company user requires giving them sites.
  async update(
    actor: ActingUser,
    id: string,
    input: UpdateUserInput,
  ): Promise<User> {
    const user = await this.getOrThrow(id);

    // No lock-out: you can't take away your own access. Another
    // super-admin has to do that.
    if (actor.id === id) {
      if (input.isActive === false) {
        throw new BadRequestException("You can't deactivate your own account");
      }
      if (input.role !== undefined && input.role !== user.role) {
        throw new BadRequestException("You can't change your own role");
      }
    }

    const role = input.role !== undefined ? validRole(input.role) : user.role;
    const changes: Partial<User> = {
      role,
      siteIds: await this.validSiteIds(role, input.siteIds ?? user.siteIds),
    };
    if (input.fullName !== undefined) {
      changes.fullName = validFullName(input.fullName);
    }
    if (input.isActive !== undefined) changes.isActive = input.isActive;

    await this.repo.update({ id }, changes);
    return this.getOrThrow(id);
  }

  // A reset doesn't end sessions already open: their tokens stay valid until
  // they expire (JWT_EXPIRES_IN_SECONDS). To lock someone out at once,
  // deactivate them first.
  async setPassword(id: string, password: string): Promise<void> {
    checkPassword(password);
    const result = await this.repo.update(
      { id },
      { passwordHash: await hashPassword(password) },
    );
    if (!result.affected) throw new NotFoundException('User not found');
  }

  // De-duplicates and checks the sites exist. Super-admins see every site,
  // so their list is always stored empty.
  private async validSiteIds(
    role: UserRole,
    siteIds: string[],
  ): Promise<string[]> {
    if (role === 'super_admin') return [];
    const unique = [...new Set(siteIds)];
    if (unique.length === 0) {
      throw new BadRequestException('A company user needs at least one site');
    }
    const existing = new Set(await this.sites.existingIds(unique));
    const unknown = unique.filter((siteId) => !existing.has(siteId));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown site(s): ${unknown.join(', ')}`);
    }
    return unique;
  }
}
