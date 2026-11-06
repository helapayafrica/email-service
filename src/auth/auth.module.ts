import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../users/user.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    UserModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must be at least 32characters');
        }
        return {
          secret,
          signOptions: {
            expiresIn: Number(config.get('JWT_EXPIRES_IN_SECONDS') ?? 3600),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  // Exported so the guard in step 4 can verify tokens.
  exports: [JwtModule],
})
export class AuthModule {}
