import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import { isEmail } from 'class-validator';
import { hashPassword } from './password.js';
import { isKnownSite } from '../config/sites.config.js';

export const MIN_PASSWORD_LENGTH = 12;

export interface CreateUserInput {
  email: string;
  fullName: string;
  siteId: string;
  password: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo.findOne({
      where: { email: normalizeEmail(email) },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        siteId: true,
        fullName: true,
      },
    });
  }

  async create(input: CreateUserInput): Promise<User> {
    const email = normalizeEmail(input.email);
    const fullName = input.fullName.trim();

    if (!isEmail(email)) {
      throw new BadRequestException('Invalid email address');
    }

    if (!fullName) {
      throw new BadRequestException('Full name is required');
    }

    if (!isKnownSite(input.siteId)) {
      throw new BadRequestException(`Unknown site "${input.siteId}"`);
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
          siteId: input.siteId,
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
        throw new ConflictException(`A user with email${email} already exists`);
      }
      throw error;
    }
  }
}
