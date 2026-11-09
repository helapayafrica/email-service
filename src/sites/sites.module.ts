import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from './entities/site.entity.js';
import { SecretBox } from './site-secrets.js';
import { SitesService } from './sites.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Site])],
  providers: [
    {
      provide: SecretBox,
      inject: [ConfigService],
      // Throws at startup if SITE_SECRETS_KEY is missing or the wrong size,
      // rather than on the first request that needs a secret.
      useFactory: (config: ConfigService) =>
        new SecretBox(config.get<string>('SITE_SECRETS_KEY')),
    },
    SitesService,
  ],
  exports: [SitesService],
})
export class SitesModule {}
