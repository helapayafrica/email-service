import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '../auth/auth-user.js';
import type { SitesService } from '../sites/sites.service.js';
import { CompanySitesController } from './company-sites.controller.js';
import { UpdateCcDto } from './dto/update-cc.dto.js';

const user: AuthUser = {
  id: 'u1',
  email: 'jane@deliva.com',
  fullName: 'Jane',
  role: 'company_user',
  siteIds: ['deliva'],
};

describe('CompanySitesController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('audit-logs exactly which CC addresses were added and removed, and by whom', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const sites = {
      setCc: vi.fn().mockResolvedValue({
        site: { id: 'deliva' },
        added: ['new@x.test'],
        removed: [],
      }),
    };
    const controller = new CompanySitesController(
      sites as unknown as SitesService,
    );

    await expect(
      controller.setCc(user, 'deliva', { cc: ['new@x.test'] }),
    ).resolves.toEqual({ id: 'deliva' });
    expect(sites.setCc).toHaveBeenCalledWith(user, 'deliva', ['new@x.test']);
    expect(warn).toHaveBeenCalledWith(
      'Site CC updated siteId=deliva added=new@x.test removed=- by userId=u1',
    );
  });
});

describe('UpdateCcDto', () => {
  const errors = async (body: object) =>
    (await validate(plainToInstance(UpdateCcDto, body))).map(
      (error) => error.property,
    );

  it.each([
    ['a list of addresses', { cc: ['a@x.test', 'b@x.test'] }],
    ['an empty list', { cc: [] }],
  ])('accepts %s', async (_case, body) => {
    await expect(errors(body)).resolves.toEqual([]);
  });

  it.each([
    ['a missing list', {}],
    ['a string instead of a list', { cc: 'a@x.test' }],
    ['an invalid address', { cc: ['a@x.test', 'nope'] }],
    [
      '11 addresses',
      { cc: Array.from({ length: 11 }, (_, n) => `a${n}@x.test`) },
    ],
  ])('rejects %s', async (_case, body) => {
    await expect(errors(body)).resolves.toEqual(['cc']);
  });
});
