import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SitesService } from '../../sites/sites.service.js';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly sites: SitesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const body = req.body as { siteId?: unknown } | undefined;
    const siteId = body?.siteId;
    const apiKey = req.headers['x-api-key'];

    if (typeof siteId !== 'string' || typeof apiKey !== 'string' || !apiKey) {
      throw new UnauthorizedException('Invalid API key or site');
    }

    // Find the site by the key's hash, then check it is the site the body
    // claims. A valid key for one site can't post as another.
    const site = await this.sites.findActiveByApiKey(apiKey);
    if (!site || site.id !== siteId) {
      throw new UnauthorizedException('Invalid API key or site');
    }
    return true;
  }
}
