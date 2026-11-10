import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { SuperAdminGuard } from '../auth/super-admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import * as authUser from '../auth/auth-user.js';
import type { User, UserRole } from '../users/entities/user.entity.js';
import { UserService } from '../users/user.service.js';
import { SitesService } from '../sites/sites.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { SetPasswordDto } from './dto/set-password.dto.js';

// What super-admins see. Never the password hash.
export interface UserView {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  // The companies a company_user can see; empty for a super_admin, who sees
  // every company.
  sites: { id: string; name: string }[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('Admin: users')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired token' })
@ApiForbiddenResponse({ description: 'Not a super-admin' })
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly users: UserService,
    private readonly sites: SitesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  async list() {
    const users = await this.users.list();
    return this.toViews(users);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one user' })
  @ApiNotFoundResponse({ description: 'No such user' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.toView(await this.users.getOrThrow(id));
  }

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiConflictResponse({ description: 'Email already in use' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: authUser.AuthUser,
  ) {
    const user = await this.users.create(dto);
    this.logger.log(
      `User created userId=${user.id} role=${user.role} sites=${user.siteIds.join(',') || '-'} by userId=${actor.id}`,
    );
    return this.toView(user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: "Update a user's name, role, companies or active status",
    description:
      "Only the fields sent change. Takes effect on the user's next request.",
  })
  @ApiNotFoundResponse({ description: 'No such user' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: authUser.AuthUser,
  ) {
    const user = await this.users.update(actor, id, dto);
    this.logger.log(
      `User updated userId=${id} role=${user.role} sites=${user.siteIds.join(',') || '-'} isActive=${user.isActive} by userId=${actor.id}`,
    );
    return this.toView(user);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Reset a user's password",
    description:
      'Sessions already open stay valid until their token expires. To lock someone out at once, deactivate them first.',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiNotFoundResponse({ description: 'No such user' })
  async setPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
    @CurrentUser() actor: authUser.AuthUser,
  ): Promise<void> {
    await this.users.setPassword(id, dto.password);
    this.logger.warn(`User password reset userId=${id} by userId=${actor.id}`);
  }

  private async toView(user: User): Promise<UserView> {
    return (await this.toViews([user]))[0];
  }

  // One site-name query for the whole page.
  private async toViews(users: User[]): Promise<UserView[]> {
    const names = await this.sites.namesById(
      users.flatMap((user) => user.siteIds),
    );
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sites: user.siteIds.map((id) => ({ id, name: names.get(id) ?? id })),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));
  }
}
