import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '../auth/auth-user.js';
import type { SitesService } from '../sites/sites.service.js';
import type { User } from '../users/entities/user.entity.js';
import type { UserService } from '../users/user.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { SetPasswordDto } from './dto/set-password.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

const admin: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  fullName: 'Admin',
  role: 'super_admin',
  siteIds: [],
};

const janeFields = {
  id: 'u1',
  email: 'jane@deliva.com',
  fullName: 'Jane',
  role: 'company_user',
  siteIds: ['deliva', 'gone'],
  isActive: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};
const jane = janeFields as User;

describe('AdminUsersController', () => {
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let logs: string[];
  let controller: AdminUsersController;

  beforeEach(() => {
    logs = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    vi.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
    users = {
      list: vi.fn().mockResolvedValue([jane]),
      create: vi.fn().mockResolvedValue(jane),
      update: vi.fn().mockResolvedValue(jane),
      setPassword: vi.fn().mockResolvedValue(undefined),
    };
    const sites = {
      namesById: vi
        .fn()
        .mockResolvedValue(new Map([['deliva', 'Deliva Fasta']])),
    };
    controller = new AdminUsersController(
      users as unknown as UserService,
      sites as unknown as SitesService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns users with company names and no password hash', async () => {
    const [view] = await controller.list();

    expect(view.sites).toEqual([
      { id: 'deliva', name: 'Deliva Fasta' },
      { id: 'gone', name: 'gone' },
    ]);
    expect(view).not.toHaveProperty('passwordHash');
  });

  it('passes the acting super-admin to update, for the lock-out checks', async () => {
    await controller.update('u1', { isActive: false }, admin);

    expect(users.update).toHaveBeenCalledWith(admin, 'u1', {
      isActive: false,
    });
  });

  it('audit-logs every change without the password', async () => {
    await controller.create(
      { ...janeFields, password: 'initial-password-123' } as CreateUserDto,
      admin,
    );
    await controller.update('u1', { siteIds: ['deliva'] }, admin);
    await controller.setPassword(
      'u1',
      { password: 'reset-password-456' },
      admin,
    );

    expect(logs).toEqual([
      'User created userId=u1 role=company_user sites=deliva,gone by userId=admin-1',
      'User updated userId=u1 role=company_user sites=deliva,gone isActive=true by userId=admin-1',
      'User password reset userId=u1 by userId=admin-1',
    ]);
    expect(logs.join(' ')).not.toMatch(/initial-password|reset-password/);
  });
});

describe('user DTOs', () => {
  const errors = async <T extends object>(cls: new () => T, body: object) =>
    (await validate(plainToInstance(cls, body))).map((error) => error.property);

  const valid = {
    email: 'jane@deliva.com',
    fullName: 'Jane',
    role: 'company_user',
    siteIds: ['deliva'],
    password: 'initial-password-123',
  };

  it('accepts a valid new user', async () => {
    await expect(errors(CreateUserDto, valid)).resolves.toEqual([]);
  });

  it.each([
    ['a bad email', { email: 'nope' }, 'email'],
    ['an unknown role', { role: 'admin' }, 'role'],
    ['a short password', { password: 'short' }, 'password'],
    ['siteIds that are not a list', { siteIds: 'deliva' }, 'siteIds'],
  ])('rejects a new user with %s', async (_case, overrides, property) => {
    await expect(
      errors(CreateUserDto, { ...valid, ...overrides }),
    ).resolves.toEqual([property]);
  });

  it.each(['fullName', 'role', 'siteIds', 'isActive'])(
    'does not let an update set %s to null',
    async (property) => {
      await expect(
        errors(UpdateUserDto, { [property]: null }),
      ).resolves.toEqual([property]);
    },
  );

  it('accepts an empty update', async () => {
    await expect(errors(UpdateUserDto, {})).resolves.toEqual([]);
  });

  it('rejects a short reset password', async () => {
    await expect(
      errors(SetPasswordDto, { password: 'short' }),
    ).resolves.toEqual(['password']);
  });
});
