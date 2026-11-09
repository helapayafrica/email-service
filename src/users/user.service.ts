import {
  BadRequestException,
  ConflictException,
  Injectable,
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
    const fullName = input.fullName.trim();
    const siteIds = [...new Set(input.siteIds)]; // drop duplicates

    if (!isEmail(email)) {
      throw new BadRequestException('Invalid email address');
    }
    if (!fullName) {
      throw new BadRequestException('Full name is required');
    }
    if (!USER_ROLES.includes(input.role)) {
      throw new BadRequestException(
        `Role must be one of: ${USER_ROLES.join(', ')}`,
      );
    }
    if (input.role === 'company_user' && siteIds.length === 0) {
      throw new BadRequestException('A company user needs at least one site');
    }
    const existing = new Set(await this.sites.existingIds(siteIds));
    const unknown = siteIds.filter((siteId) => !existing.has(siteId));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown site(s): ${unknown.join(', ')}`);
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }

    try {
      const saved = await this.repo.save(
        this.repo.create({
          email,
          fullName,
          role: input.role,
          // Super-admins see everything, so their list stays empty.
          siteIds: input.role === 'super_admin' ? [] : siteIds,
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
}
