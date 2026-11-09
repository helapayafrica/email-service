import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service.js';
import { User } from './entities/user.entity.js';
import { SitesModule } from '../sites/sites.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([User]), SitesModule],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
