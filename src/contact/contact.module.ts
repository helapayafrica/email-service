import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ContactRequest } from './entities/contact-request.entity.js';
import { ContactController } from './contact.controller.js';
import { ContactService } from './contact.service.js';
import { SitesModule } from '../sites/sites.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContactRequest]),
    BullModule.registerQueue({ name: 'mail' }),
    // ApiKeyGuard and ContactService look sites up.
    SitesModule,
  ],
  controllers: [ContactController],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule {}
