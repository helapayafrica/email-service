import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

// Use after JwtAuthGuard, which loads request.user:
//   @UseGuards(JwtAuthGuard, SuperAdminGuard)
// Guards run in the order listed.
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role !== 'super_admin') {
      throw new ForbiddenException('Super-admin access required');
    }
    return true;
  }
}
