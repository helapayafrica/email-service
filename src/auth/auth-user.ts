import type { UserRole } from '../users/entities/user.entity.js';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  siteIds: string[];
}
