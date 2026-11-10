import { BadRequestException, ConflictException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { SitesService } from '../sites/sites.service.js';
import type { User } from './entities/user.entity.js';
import { verifyPassword } from './password.js';
import { UserService, type CreateUserInput } from './user.service.js';

describe('UserService.create', () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
  };
  let sites: { existingIds: ReturnType<typeof vi.fn> };
  let service: UserService;

  const companyUser: CreateUserInput = {
    email: 'jane@deliva.com',
    fullName: 'Jane Doe',
    password: 'correct-horse-battery',
    role: 'company_user',
    siteIds: ['deliva'],
  };

  beforeEach(() => {
    repo = {
      create: vi.fn((row: Partial<User>) => row),
      save: vi.fn((row: Partial<User>) =>
        Promise.resolve({ ...row, id: 'u1' }),
      ),
      // What the database returns on re-read: passwordHash is select: false.
      findOneByOrFail: vi.fn(() =>
        Promise.resolve({ id: 'u1', email: 'jane@deliva.com' }),
      ),
    };
    sites = {
      existingIds: vi.fn((ids: string[]) =>
        Promise.resolve(ids.filter((id) => ['deliva', 'voltic'].includes(id))),
      ),
    };
    service = new UserService(
      repo as unknown as Repository<User>,
      sites as unknown as SitesService,
    );
  });

  const saved = () => repo.save.mock.calls[0][0] as Partial<User>;

  it('stores a normalised user with an argon2id hash of the password', async () => {
    await service.create({
      ...companyUser,
      email: '  Jane@Deliva.COM ',
      fullName: '  Jane Doe ',
      siteIds: ['deliva', 'voltic', 'deliva'],
    });

    expect(saved()).toMatchObject({
      email: 'jane@deliva.com',
      fullName: 'Jane Doe',
      role: 'company_user',
      siteIds: ['deliva', 'voltic'], // duplicates dropped
    });
    expect(saved().passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(saved().passwordHash!, 'correct-horse-battery'),
    ).resolves.toBe(true);
  });

  it('returns the re-read user, which has no password hash', async () => {
    const user = await service.create(companyUser);

    expect(repo.findOneByOrFail).toHaveBeenCalledWith({ id: 'u1' });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('stores no sites for a super-admin, whatever was passed', async () => {
    await service.create({
      ...companyUser,
      role: 'super_admin',
      siteIds: ['deliva'],
    });

    expect(saved()).toMatchObject({ role: 'super_admin', siteIds: [] });
  });

  it.each<[string, Partial<CreateUserInput>, string]>([
    ['an invalid email', { email: 'not-an-email' }, 'Invalid email address'],
    ['an empty name', { fullName: '   ' }, 'Full name is required'],
    [
      'an unknown role',
      { role: 'admin' as CreateUserInput['role'] },
      'Role must be one of',
    ],
    [
      'a company user without sites',
      { siteIds: [] },
      'A company user needs at least one site',
    ],
    [
      'a site that does not exist',
      { siteIds: ['deliva', 'nope'] },
      'Unknown site(s): nope',
    ],
    [
      'a password under 12 characters',
      { password: 'short-pass1' },
      'Password must be at least 12 characters',
    ],
  ])('rejects %s', async (_case, overrides, message) => {
    const result = service.create({ ...companyUser, ...overrides });

    await expect(result).rejects.toThrow(BadRequestException);
    await expect(result).rejects.toThrow(message);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('reports an email that is already taken', async () => {
    repo.save.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      ),
    );

    await expect(service.create(companyUser)).rejects.toThrow(
      new ConflictException('A user with email jane@deliva.com already exists'),
    );
  });

  it('rethrows other database errors', async () => {
    repo.save.mockRejectedValue(new Error('connection lost'));

    await expect(service.create(companyUser)).rejects.toThrow(
      'connection lost',
    );
  });
});
