import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import * as authUser from './auth-user.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Much stricter than the global limit: 5 attempts per minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive a bearer token' })
  @ApiOkResponse({
    schema: {
      example: {
        accessToken: 'eyJhbGciOi...',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: {
          id: '6f1c...',
          email: 'jane@deliva.com',
          fullName: 'Jane Doe',
          role: 'company_user',
          sites: [{ id: 'deliva', name: 'Deliva Fasta' }],
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'Too many login attempts' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get the logged-in user' })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, or expired token',
  })
  me(@CurrentUser() user: authUser.AuthUser) {
    return this.authService.profile(user);
  }
}
