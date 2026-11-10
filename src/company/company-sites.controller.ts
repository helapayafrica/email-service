import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import * as authUser from '../auth/auth-user.js';
import { SitesService } from '../sites/sites.service.js';
import { UpdateCcDto } from './dto/update-cc.dto.js';

// Company settings any logged-in user may manage for the sites they can see.
// (SMTP and API keys stay under /admin/sites, for super-admins.)
@ApiTags('Company sites')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired token' })
@UseGuards(JwtAuthGuard)
@Controller('sites')
export class CompanySitesController {
  private readonly logger = new Logger(CompanySitesController.name);

  constructor(private readonly sites: SitesService) {}

  @Get()
  @ApiOperation({
    summary: 'List the companies you can see, with recipient and CC list',
  })
  list(@CurrentUser() user: authUser.AuthUser) {
    return this.sites.listForUser(user);
  }

  @Put(':id/cc')
  @ApiOperation({
    summary: "Replace a company's CC list",
    description:
      "Every new contact email for the company is CC'd to these addresses. Emails already delivered are not re-sent.",
  })
  @ApiNotFoundResponse({ description: 'Not one of your companies' })
  async setCc(
    @CurrentUser() user: authUser.AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCcDto,
  ) {
    const { site, added, removed } = await this.sites.setCc(user, id, dto.cc);
    // Addresses are logged on purpose: whoever edits CC can copy a company's
    // future submissions elsewhere, so every change must be traceable.
    this.logger.warn(
      `Site CC updated siteId=${id} added=${added.join(',') || '-'} removed=${removed.join(',') || '-'} by userId=${user.id}`,
    );
    return site;
  }
}
