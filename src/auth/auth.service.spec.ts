import { Logger, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { SitesService } from '../sites/sites.service.js';
import type { User } from '../users/entities/user.entity.js';
import { hashPassword, verifyPassword } from '../users/password.js';
import type { UserService } from '../users/user.service.js';
import { AuthService } from './auth.service.js';

// Wrap the real verifyPassword in a spy, to check the timing protection.
vi.mock('../users/password.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../users/password.js')>();
  return { ...real, verifyPassword: vi.fn(real.verifyPassword) };
});

const PASSWORD = 'correct-horse-battery';

describe('AuthService', () => {
  let passwordHash: string;
  let users: { findByEmailWithPassword: ReturnType<typeof vi.fn> };
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  let sites: {
    accessibleSiteIds: ReturnType<typeof vi.fn>;
    namesById: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;

  const user = (overrides: Partial<User> = {}): Partial<User> => ({
    id: 'u1',
    email: 'jane@deliva.com',
    fullName: 'Jane Doe',
    role: 'company_user',
    siteIds: ['deliva', 'gone'],
    isActive: true,
    passwordHash,
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.mocked(verifyPassword).mockClear();
    users = { findByEmailWithPassword: vi.fn().mockResolvedValue(user()) };
    jwt = { signAsync: vi.fn().mockResolvedValue('signed.jwt.token') };
    sites = {
      accessibleSiteIds: vi.fn((u: { siteIds: string[] }) =>
        Promise.resolve(u.siteIds),
      ),
      // 'gone' has no site row any more.
      namesById: vi
        .fn()
        .mockResolvedValue(new Map([['deliva', 'Deliva Fasta']])),
    };
    service = new AuthService(
      users as unknown as UserService,
      jwt as unknown as JwtService,
      sites as unknown as SitesService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const login = (password = PASSWORD) =>
    service.login({ email: 'jane@deliva.com', password });

  it('returns a token and the profile on success', async () => {
    await expect(login()).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: {
        id: 'u1',
        email: 'jane@deliva.com',
        fullName: 'Jane Doe',
        role: 'company_user',
        sites: [
          { id: 'deliva', name: 'Deliva Fasta' },
          { id: 'gone', name: 'gone' }, // falls back to the id
        ],
      },
    });
  });

  it('puts only the user id and email in the token', async () => {
    await login();

    // Role and sites are reloaded from the database on every request, so
    // they can't go stale inside a token.
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'u1',
      email: 'jane@deliva.com',
    });
  });

  it('never returns the password hash', async () => {
    const result = await login();

    expect(JSON.stringify(result)).not.toContain('$argon2');
  });

  it.each([
    ['a wrong password', () => login('wrong-password-123')],
    [
      'an inactive user with the right password',
      () => {
        users.findByEmailWithPassword.mockResolvedValue(
          user({ isActive: false }),
        );
        return login();
      },
    ],
    [
      'an unknown email',
      () => {
        users.findByEmailWithPassword.mockResolvedValue(null);
        return login();
      },
    ],
  ])(
    'rejects %s with the same message and no token',
    async (_case, attempt) => {
      await expect(attempt()).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    },
  );

  it('still verifies a password for an unknown email, so timing reveals nothing', async () => {
    users.findByEmailWithPassword.mockResolvedValue(null);

    await expect(login()).rejects.toThrow(UnauthorizedException);
    expect(verifyPassword).toHaveBeenCalledOnce();
  });
});
