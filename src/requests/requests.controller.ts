import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import * as authUser from '../auth/auth-user.js';
import { ListRequestsQuery } from './dto/list-requests.query.js';
import { RequestsService } from './requests.service.js';

@ApiTags('Requests')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired token' })
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  private readonly logger = new Logger(RequestsController.name);

  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  @ApiOperation({
    summary: 'List contact requests for the sites you can access',
  })
  @ApiNotFoundResponse({ description: 'siteId is not one of your sites' })
  list(
    @CurrentUser() user: authUser.AuthUser,
    @Query() query: ListRequestsQuery,
  ) {
    return this.requestsService.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one contact request' })
  @ApiNotFoundResponse({ description: 'No such request on your sites' })
  findOne(
    @CurrentUser() user: authUser.AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requestsService.findOne(user, id);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop delivering a request that has not been sent yet',
    description:
      'For queued requests and failed ones that would be retried. No more attempts are made and the status becomes cancelled. An attempt already in progress may still succeed.',
  })
  @ApiNotFoundResponse({ description: 'No such request on your sites' })
  @ApiConflictResponse({ description: 'Already sent, or delivery already stopped' })
  async stop(
    @CurrentUser() user: authUser.AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const view = await this.requestsService.stopDelivery(user, id);
    this.logger.warn(
      `Contact email delivery stopped requestId=${id} siteId=${view.siteId} by userId=${user.id}`,
    );
    return view;
  }
}
