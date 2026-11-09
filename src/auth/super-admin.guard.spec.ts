import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user.js';
import { SuperAdminGuard } from './super-admin.guard.js';

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  function context(user?: Partial<AuthUser>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as ExecutionContext;
  }

  it('allows a super-admin', () => {
    expect(guard.canActivate(context({ role: 'super_admin' }))).toBe(true);
  });

  it('rejects a company user, even one with access to every site', () => {
    expect(() =>
      guard.canActivate(
        context({ role: 'company_user', siteIds: ['deliva', 'alumni'] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request JwtAuthGuard did not authenticate', () => {
    expect(() => guard.canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
