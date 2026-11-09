import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '../auth/auth-user.js';
import type { SitesService } from '../sites/sites.service.js';
import { AdminSitesController } from './admin-sites.controller.js';
import { CreateSiteDto } from './dto/create-site.dto.js';
import { UpdateSiteDto } from './dto/update-site.dto.js';

const admin: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  fullName: 'Admin',
  role: 'super_admin',
  siteIds: [],
};

describe('AdminSitesController', () => {
  let sites: Record<string, ReturnType<typeof vi.fn>>;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let controller: AdminSitesController;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    sites = {
      update: vi.fn().mockResolvedValue({ id: 'acme' }),
      rotateApiKey: vi.fn().mockResolvedValue('sk_new'),
      revealApiKey: vi.fn().mockResolvedValue('sk_current'),
    };
    controller = new AdminSitesController(sites as unknown as SitesService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const logged = () =>
    [...log.mock.calls, ...warn.mock.calls].map((call) => String(call[0]));

  it('logs the names of the updated fields, never their values', async () => {
    // As the ValidationPipe builds it: unsent fields exist as undefined.
    const dto = plainToInstance(UpdateSiteDto, {
      smtpPass: 'acme-smtp-pass',
      smtpHost: null,
    });

    await controller.update('acme', dto, admin);

    expect(logged()).toEqual([
      'Site updated siteId=acme fields=smtpHost,smtpPass by userId=admin-1',
    ]);
  });

  it('audits key rotation and reveal without logging the key', async () => {
    await expect(controller.rotateKey('acme', admin)).resolves.toEqual({
      apiKey: 'sk_new',
    });
    await expect(controller.revealKey('acme', admin)).resolves.toEqual({
      apiKey: 'sk_current',
    });

    expect(logged()).toEqual([
      'Site API key rotated siteId=acme by userId=admin-1',
      'Site API key revealed siteId=acme by userId=admin-1',
    ]);
  });
});

describe('site DTOs', () => {
  const errorsFor = async <T extends object>(
    cls: new () => T,
    body: object,
  ): Promise<string[]> =>
    (await validate(plainToInstance(cls, body))).map((error) => error.property);

  it('accepts a minimal site', async () => {
    await expect(
      errorsFor(CreateSiteDto, {
        id: 'acme',
        name: 'Acme',
        recipient: 'a@acme.test',
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['an invalid id', { id: 'Acme_Ltd' }, 'id'],
    ['an invalid recipient', { recipient: 'nope' }, 'recipient'],
    ['a non-integer port', { smtpPort: 25.5 }, 'smtpPort'],
    ['a port out of range', { smtpPort: 70000 }, 'smtpPort'],
  ])('rejects a site with %s', async (_case, overrides, property) => {
    await expect(
      errorsFor(CreateSiteDto, {
        id: 'acme',
        name: 'Acme',
        recipient: 'a@acme.test',
        ...overrides,
      }),
    ).resolves.toEqual([property]);
  });

  it('lets an update clear SMTP fields with null', async () => {
    await expect(
      errorsFor(UpdateSiteDto, {
        smtpHost: null,
        smtpUser: null,
        smtpPass: null,
        smtpFrom: null,
        smtpPort: null,
      }),
    ).resolves.toEqual([]);
  });

  it.each(['name', 'recipient', 'isActive'])(
    'does not let an update set %s to null',
    async (property) => {
      await expect(
        errorsFor(UpdateSiteDto, { [property]: null }),
      ).resolves.toEqual([property]);
    },
  );
});
