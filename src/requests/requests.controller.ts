import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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
import { ListRequestsQuery } from './dto/list-requests.query.js';
import { RequestsService } from './requests.service.js';

@ApiTags('Requests')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired token' })
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
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
}
