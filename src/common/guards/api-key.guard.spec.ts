import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { SitesService } from '../../sites/sites.service.js';
import { ApiKeyGuard } from './api-key.guard.js';

describe('ApiKeyGuard', () => {
  let sites: { findActiveByApiKey: ReturnType<typeof vi.fn> };
  let guard: ApiKeyGuard;

  beforeEach(() => {
    sites = {
      // Only 'secret-key' belongs to an active site, and that site is deliva.
      findActiveByApiKey: vi.fn((key: string) =>
        Promise.resolve(key === 'secret-key' ? { id: 'deliva' } : null),
      ),
    };
    guard = new ApiKeyGuard(sites as unknown as SitesService);
  });

  function context(siteId: unknown, apiKey?: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          body: { siteId },
          headers: apiKey === undefined ? {} : { 'x-api-key': apiKey },
        }),
      }),
    } as ExecutionContext;
  }

  it('allows a request whose key belongs to the site in the body', async () => {
    await expect(
      guard.canActivate(context('deliva', 'secret-key')),
    ).resolves.toBe(true);
    expect(sites.findActiveByApiKey).toHaveBeenCalledWith('secret-key');
  });

  it.each([
    ['a valid key used for another site', 'voltic', 'secret-key'],
    ['an unknown or inactive site key', 'deliva', 'wrong-key'],
    ['a missing key', 'deliva', undefined],
    ['an empty key', 'deliva', ''],
    ['a repeated header (array)', 'deliva', ['secret-key', 'secret-key']],
    ['a missing siteId', undefined, 'secret-key'],
    ['a non-string siteId', ['deliva'], 'secret-key'],
  ])('rejects %s', async (_case, siteId, apiKey) => {
    await expect(guard.canActivate(context(siteId, apiKey))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
