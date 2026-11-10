import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '../users/entities/user.entity.js';
import type { UserService } from '../users/user.service.js';
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard.js';

const SECRET = 'test-secret-that-is-at-least-32-characters';

describe('JwtAuthGuard', () => {
  // A real JwtService, so signatures and expiry are actually checked.
  const jwt = new JwtService({ secret: SECRET });
  let users: { findById: ReturnType<typeof vi.fn> };
  let guard: JwtAuthGuard;

  const dbUser: Partial<User> = {
    id: 'u1',
    email: 'jane@deliva.com',
    fullName: 'Jane Doe',
    role: 'company_user',
    siteIds: ['deliva'],
    isActive: true,
  };

  beforeEach(() => {
    users = { findById: vi.fn().mockResolvedValue(dbUser) };
    guard = new JwtAuthGuard(jwt, users as unknown as UserService);
  });

  function request(authorization?: string): AuthenticatedRequest {
    return {
      headers: authorization ? { authorization } : {},
    } as AuthenticatedRequest;
  }

  function context(req: AuthenticatedRequest): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
  }

  const token = (payload: object = { sub: 'u1', email: 'jane@deliva.com' }) =>
    jwt.signAsync(payload);

  it('accepts a valid token and loads the user from the database', async () => {
    const req = request(`Bearer ${await token()}`);

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(users.findById).toHaveBeenCalledWith('u1');
    expect(req.user).toEqual({
      id: 'u1',
      email: 'jane@deliva.com',
      fullName: 'Jane Doe',
      role: 'company_user',
      siteIds: ['deliva'],
    });
  });

  it('takes role and sites from the database, not from the token', async () => {
    const req = request(
      `Bearer ${await token({ sub: 'u1', email: 'x', role: 'super_admin', siteIds: ['voltic'] })}`,
    );

    await guard.canActivate(context(req));

    expect(req.user).toMatchObject({
      role: 'company_user',
      siteIds: ['deliva'],
    });
  });

  it('accepts a lowercase scheme', async () => {
    await expect(
      guard.canActivate(context(request(`bearer ${await token()}`))),
    ).resolves.toBe(true);
  });

  it.each([
    ['no Authorization header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['a scheme without a token', 'Bearer'],
  ])('rejects %s as a missing token', async (_case, header) => {
    await expect(guard.canActivate(context(request(header)))).rejects.toThrow(
      new UnauthorizedException('Missing bearer token'),
    );
    expect(users.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed token', async () => 'not.a.jwt'],
    [
      'a token signed with another secret',
      () => new JwtService({ secret: 'x'.repeat(40) }).signAsync({ sub: 'u1' }),
    ],
    [
      'an expired token',
      () => token({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 60 }),
    ],
  ])('rejects %s', async (_case, makeToken) => {
    const req = request(`Bearer ${await makeToken()}`);

    await expect(guard.canActivate(context(req))).rejects.toThrow(
      new UnauthorizedException('Invalid or expired token'),
    );
    expect(users.findById).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it.each([
    ['a deleted user', null],
    ['an inactive user', { ...dbUser, isActive: false }],
  ])('rejects a valid token for %s', async (_case, found) => {
    users.findById.mockResolvedValue(found);
    const req = request(`Bearer ${await token()}`);

    await expect(guard.canActivate(context(req))).rejects.toThrow(
      new UnauthorizedException('Invalid or expired token'),
    );
    expect(req.user).toBeUndefined();
  });
});
