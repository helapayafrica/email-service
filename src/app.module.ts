import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from './mail/mail.module.js';
import { ContactModule } from './contact/contact.module.js';
import { dataSourceOptions } from './database/data-source.js';
import { AuthModule } from './auth/auth.module.js';
import { SitesModule } from './sites/sites.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CompanyModule } from './company/company.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RequestsModule } from './requests/requests.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 30),
      },
    ]),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
        // Bull requires persistent Redis connections. Queue operations wait for
        // Redis to reconnect instead of failing an HTTP request after 20 retries.
        maxRetriesPerRequest: null,
      },
    }),
    ContactModule,
    MailModule,
    AuthModule,
    RequestsModule,
    SitesModule,
    AdminModule,
    CompanyModule,
  ],
  // GET / health check, used by the deployment guides' smoke tests.
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
