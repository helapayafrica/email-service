import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ContactRequest } from '../contact/entities/contact-request.entity.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ContactRequest])],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
