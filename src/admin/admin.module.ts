import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { AdminSitesController } from './admin-sites.controller.js';
import { AdminUsersController } from './admin-users.controller.js';

// Super-admin endpoints. Kept out of SitesModule because AuthModule (needed
// for JwtAuthGuard) already imports SitesModule.
@Module({
  imports: [AuthModule, SitesModule],
  controllers: [AdminSitesController, AdminUsersController],
})
export class AdminModule {}
