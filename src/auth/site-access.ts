import { listSiteIds } from '../config/sites.config.js';
import type { AuthUser } from './auth-user.js';

export function accessibleSiteIds(user: AuthUser): string[] {
  return user.role === 'super_admin' ? listSiteIds() : user.siteIds;
}

export function canAccessSite(user: AuthUser, siteId: string): boolean {
  return accessibleSiteIds(user).includes(siteId);
}
