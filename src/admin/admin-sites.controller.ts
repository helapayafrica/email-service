import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { SuperAdminGuard } from '../auth/super-admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import * as authUser from '../auth/auth-user.js';
import { SitesService } from '../sites/sites.service.js';
import { CreateSiteDto } from './dto/create-site.dto.js';
import { UpdateSiteDto } from './dto/update-site.dto.js';

// Responses that contain an API key must not be stored by browsers or proxies.
const NO_STORE = ['Cache-Control', 'no-store'] as const;

@ApiTags('Admin: sites')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired token' })
@ApiForbiddenResponse({ description: 'Not a super-admin' })
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/sites')
export class AdminSitesController {
  private readonly logger = new Logger(AdminSitesController.name);

  constructor(private readonly sites: SitesService) {}

  @Get()
  @ApiOperation({ summary: 'List all sites, including inactive ones' })
  list() {
    return this.sites.listViews();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one site' })
  @ApiNotFoundResponse({ description: 'No such site' })
  get(@Param('id') id: string) {
    return this.sites.getView(id);
  }

  @Post()
  @Header(...NO_STORE)
  @ApiOperation({
    summary: 'Create a site',
    description:
      'Returns the new site and its API key. Put the key in the website as x-api-key; it can be revealed again later.',
  })
  @ApiConflictResponse({ description: 'A site with that id already exists' })
  async create(
    @Body() dto: CreateSiteDto,
    @CurrentUser() user: authUser.AuthUser,
  ) {
    const created = await this.sites.create(dto);
    this.logger.log(`Site created siteId=${dto.id} by userId=${user.id}`);
    return created;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a site',
    description:
      'Only the fields sent are changed. Set isActive to false to deactivate. The id cannot be changed.',
  })
  @ApiNotFoundResponse({ description: 'No such site' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() user: authUser.AuthUser,
  ) {
    const site = await this.sites.update(id, dto);
    // Field names only: never log values (they include the SMTP password).
    // Filter on the value: every DTO field exists on the instance, even when
    // it wasn't sent.
    const fields = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    this.logger.log(
      `Site updated siteId=${id} fields=${fields.join(',')} by userId=${user.id}`,
    );
    return site;
  }

  @Post(':id/rotate-key')
  @HttpCode(HttpStatus.OK)
  @Header(...NO_STORE)
  @ApiOperation({
    summary: 'Issue a new API key',
    description:
      'The old key stops working immediately. Update the website with the new key straight away.',
  })
  @ApiNotFoundResponse({ description: 'No such site' })
  async rotateKey(
    @Param('id') id: string,
    @CurrentUser() user: authUser.AuthUser,
  ) {
    const apiKey = await this.sites.rotateApiKey(id);
    this.logger.warn(`Site API key rotated siteId=${id} by userId=${user.id}`);
    return { apiKey };
  }

  @Get(':id/api-key')
  @Header(...NO_STORE)
  @ApiOperation({ summary: "Reveal a site's current API key" })
  @ApiNotFoundResponse({ description: 'No such site' })
  async revealKey(
    @Param('id') id: string,
    @CurrentUser() user: authUser.AuthUser,
  ) {
    const apiKey = await this.sites.revealApiKey(id);
    this.logger.warn(`Site API key revealed siteId=${id} by userId=${user.id}`);
    return { apiKey };
  }
}
