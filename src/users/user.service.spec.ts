import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { SitesService } from '../sites/sites.service.js';
import type { User } from './entities/user.entity.js';
import { verifyPassword } from './password.js';
import { UserService, type CreateUserInput } from './user.service.js';

describe('UserService', () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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
      findOne: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
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

  describe('update', () => {
    const admin = { id: 'admin-1' };
    const stored = (overrides: Partial<User> = {}): Partial<User> => ({
      id: 'u1',
      email: 'jane@deliva.com',
      fullName: 'Jane Doe',
      role: 'company_user',
      siteIds: ['deliva'],
      isActive: true,
      ...overrides,
    });
    const changes = () => repo.update.mock.calls[0][1] as Partial<User>;

    beforeEach(() => {
      repo.findOne.mockResolvedValue(stored());
    });

    it("replaces a user's companies", async () => {
      await service.update(admin, 'u1', { siteIds: ['voltic', 'voltic'] });

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'u1' },
        { role: 'company_user', siteIds: ['voltic'] },
      );
    });

    it('keeps the current companies when only the name changes', async () => {
      await service.update(admin, 'u1', { fullName: '  Jane D. ' });

      expect(changes()).toEqual({
        role: 'company_user',
        siteIds: ['deliva'],
        fullName: 'Jane D.',
      });
    });

    it('deactivates another user', async () => {
      await service.update(admin, 'u1', { isActive: false });

      expect(changes()).toMatchObject({ isActive: false });
    });

    it('clears the companies when promoting to super-admin', async () => {
      await service.update(admin, 'u1', { role: 'super_admin' });

      expect(changes()).toMatchObject({ role: 'super_admin', siteIds: [] });
    });

    it('requires companies when demoting a super-admin', async () => {
      repo.findOne.mockResolvedValue(
        stored({ role: 'super_admin', siteIds: [] }),
      );

      await expect(
        service.update(admin, 'u1', { role: 'company_user' }),
      ).rejects.toThrow('A company user needs at least one site');

      await service.update(admin, 'u1', {
        role: 'company_user',
        siteIds: ['deliva'],
      });
      expect(changes()).toMatchObject({
        role: 'company_user',
        siteIds: ['deliva'],
      });
    });

    it.each<[string, Partial<User>, object, string]>([
      [
        'deactivate themselves',
        {},
        { isActive: false },
        "You can't deactivate your own account",
      ],
      [
        'change their own role',
        { role: 'super_admin', siteIds: [] },
        { role: 'company_user', siteIds: ['deliva'] },
        "You can't change your own role",
      ],
    ])(
      "doesn't let a super-admin %s",
      async (_case, current, input, message) => {
        repo.findOne.mockResolvedValue(stored({ id: 'admin-1', ...current }));

        await expect(service.update(admin, 'admin-1', input)).rejects.toThrow(
          message,
        );
        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it('lets a super-admin rename themselves', async () => {
      repo.findOne.mockResolvedValue(
        stored({ id: 'admin-1', role: 'super_admin', siteIds: [] }),
      );

      await service.update(admin, 'admin-1', {
        fullName: 'New Name',
        isActive: true,
        role: 'super_admin',
      });

      expect(changes()).toMatchObject({ fullName: 'New Name' });
    });

    it.each<[string, object, string]>([
      ['an unknown site', { siteIds: ['nope'] }, 'Unknown site(s): nope'],
      ['no sites', { siteIds: [] }, 'A company user needs at least one site'],
      ['an empty name', { fullName: ' ' }, 'Full name is required'],
      ['a long name', { fullName: 'x'.repeat(151) }, 'Full name is required'],
    ])('rejects %s', async (_case, input, message) => {
      await expect(service.update(admin, 'u1', input)).rejects.toThrow(message);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown user', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(admin, 'nope', { fullName: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setPassword', () => {
    it('stores a new argon2id hash', async () => {
      await service.setPassword('u1', 'a-brand-new-password');

      const { passwordHash } = repo.update.mock.calls[0][1] as Partial<User>;
      await expect(
        verifyPassword(passwordHash!, 'a-brand-new-password'),
      ).resolves.toBe(true);
    });

    it('rejects a short password without touching the user', async () => {
      await expect(service.setPassword('u1', 'too-short')).rejects.toThrow(
        'Password must be at least 12 characters',
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown user', async () => {
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.setPassword('nope', 'a-brand-new-password'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
