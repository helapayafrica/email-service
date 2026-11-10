import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { CompanySitesController } from './company-sites.controller.js';

// Kept out of SitesModule because AuthModule (needed for JwtAuthGuard)
// already imports SitesModule.
@Module({
  imports: [AuthModule, SitesModule],
  controllers: [CompanySitesController],
})
export class CompanyModule {}
