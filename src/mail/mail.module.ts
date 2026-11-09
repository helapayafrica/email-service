import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ContactModule } from '../contact/contact.module.js';
import { MailProcessor } from './mail.processor.js';
import { MailService } from './mail.service.js';
import { SitesModule } from '../sites/sites.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'mail' }),
    ContactModule,
    SitesModule,
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
