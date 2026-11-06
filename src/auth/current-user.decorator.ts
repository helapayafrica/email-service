import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

// Usage: someRoute(@CurrentUser() user: AuthUser)
// Only works on routes protected by JwtAuthGuard.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      // A programming mistake, not a client error: the guard is missing.
      throw new Error('@CurrentUser() used on a route without JwtAuthGuard');
    }
    return request.user;
  },
);
