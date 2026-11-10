import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { In, QueryFailedError, type Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user.js';
import type { Site } from './entities/site.entity.js';
import { SecretBox, hashApiKey } from './site-secrets.js';
import { SitesService } from './sites.service.js';

const box = new SecretBox(randomBytes(32).toString('base64'));

// A stored site row, with every column loaded (as loadForUpdate does).
function site(overrides: Partial<Site> = {}): Site {
  return {
    id: 'acme',
    name: 'Acme Ltd',
    recipient: 'inbox@acme.test',
    apiKeyHash: 'hash',
    apiKeyEncrypted: box.encrypt('sk_current'),
    smtpHost: null,
    smtpPort: null,
    smtpSecure: false,
    smtpUser: null,
    smtpPassEncrypted: null,
    smtpFrom: null,
    ccRecipients: [],
    isActive: true,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

const OWN_SMTP: Partial<Site> = {
  smtpHost: 'smtp.acme.test',
  smtpPort: 587,
  smtpUser: 'mailer',
  smtpPassEncrypted: box.encrypt('acme-smtp-pass'),
  smtpFrom: 'Acme <no-reply@acme.test>',
};

function uniqueViolation(constraint: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  );
}

describe('SitesService', () => {
  // getOne/getMany results for createQueryBuilder chains.
  let queryResult: { one: Site | null; many: Site[] };
  let repo: {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let service: SitesService;

  beforeEach(() => {
    queryResult = { one: site(), many: [] };
    const qb = {
      addSelect: vi.fn(() => qb),
      where: vi.fn(() => qb),
      andWhere: vi.fn(() => qb),
      orderBy: vi.fn(() => qb),
      getOne: vi.fn(() => Promise.resolve(queryResult.one)),
      getMany: vi.fn(() => Promise.resolve(queryResult.many)),
    };
    repo = {
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      createQueryBuilder: vi.fn(() => qb),
    };
    service = new SitesService(repo as unknown as Repository<Site>, box);
  });

  // The values passed to repo.insert / repo.update.
  const inserted = () => repo.insert.mock.calls[0][0] as Partial<Site>;
  const updated = () => repo.update.mock.calls[0][1] as Partial<Site>;

  describe('create', () => {
    const valid = { id: 'acme', name: 'Acme Ltd', recipient: 'a@acme.test' };

    it('generates a key and stores only its hash and an encrypted copy', async () => {
      const { apiKey } = await service.create(valid);

      expect(apiKey).toMatch(/^sk_/);
      expect(inserted().apiKeyHash).toBe(hashApiKey(apiKey));
      expect(box.decrypt(inserted().apiKeyEncrypted!)).toBe(apiKey);
      expect(JSON.stringify(inserted())).not.toContain(apiKey);
    });

    it('keeps an imported key so existing websites keep working', async () => {
      const { apiKey } = await service.create({
        ...valid,
        apiKey: '  old-website-key-123  ',
      });

      expect(apiKey).toBe('old-website-key-123');
      expect(inserted().apiKeyHash).toBe(hashApiKey('old-website-key-123'));
    });

    it('trims fields and stores no SMTP settings by default', async () => {
      await service.create({
        id: ' acme ',
        name: ' Acme ',
        recipient: valid.recipient,
      });

      expect(inserted()).toMatchObject({
        id: 'acme',
        name: 'Acme',
        smtpHost: null,
        smtpPort: null,
        smtpSecure: false,
        smtpUser: null,
        smtpPassEncrypted: null,
        smtpFrom: null,
      });
    });

    it('encrypts the SMTP password', async () => {
      await service.create({
        ...valid,
        smtpHost: 'smtp.acme.test',
        smtpUser: 'mailer',
        smtpPass: 'acme-smtp-pass',
        smtpFrom: 'no-reply@acme.test',
      });

      expect(box.decrypt(inserted().smtpPassEncrypted!)).toBe('acme-smtp-pass');
      expect(JSON.stringify(inserted())).not.toContain('acme-smtp-pass');
    });

    it('returns a view without any secrets', async () => {
      queryResult.one = site(OWN_SMTP);
      const { site: view } = await service.create(valid);

      expect(view).not.toHaveProperty('apiKeyHash');
      expect(view).not.toHaveProperty('apiKeyEncrypted');
      expect(view).not.toHaveProperty('smtpPassEncrypted');
      expect(JSON.stringify(view)).not.toContain('v1:');
      expect(view.smtp).toEqual({
        host: 'smtp.acme.test',
        port: 587,
        secure: false,
        user: 'mailer',
        hasPassword: true,
      });
    });

    it.each([
      ['an id with capitals', { id: 'Acme' }, 'Site id must be'],
      ['a one-character id', { id: 'a' }, 'Site id must be'],
      ['an id starting with a dash', { id: '-acme' }, 'Site id must be'],
      ['an empty name', { name: '   ' }, 'Name is required'],
      ['a long name', { name: 'x'.repeat(151) }, 'Name is required'],
      ['an invalid recipient', { recipient: 'nope' }, 'Recipient must be'],
      ['a short imported key', { apiKey: 'short' }, 'API key must be'],
      ['a port without a host', { smtpPort: 25 }, 'SMTP host is required'],
      ['a user without a host', { smtpUser: 'u' }, 'SMTP host is required'],
      [
        'a port out of range',
        { smtpHost: 'h', smtpFrom: 'a@b.test', smtpPort: 70000 },
        'SMTP port must be',
      ],
      [
        'a password without a user',
        { smtpHost: 'h', smtpFrom: 'a@b.test', smtpPass: 'p' },
        'SMTP password needs an SMTP user',
      ],
      [
        'a host without a From address',
        { smtpHost: 'h' },
        'SMTP From address is required',
      ],
      [
        'a From without an email address',
        { smtpFrom: 'Acme Ltd' },
        'SMTP From must be an email address',
      ],
    ])('rejects %s', async (_case, overrides, message) => {
      const result = service.create({ ...valid, ...overrides });

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow(message);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('accepts a From with a display name', async () => {
      await expect(
        service.create({ ...valid, smtpFrom: 'Acme Ltd <no-reply@acme.test>' }),
      ).resolves.toBeDefined();
    });

    it('reports a duplicate id', async () => {
      repo.insert.mockRejectedValue(uniqueViolation('PK_4f5eccb1'));

      await expect(service.create(valid)).rejects.toThrow(
        new ConflictException('A site with id acme already exists'),
      );
    });

    it('reports a duplicate API key', async () => {
      repo.insert.mockRejectedValue(uniqueViolation('UQ_fb741868'));

      await expect(service.create(valid)).rejects.toThrow(
        'That API key is already used by another site',
      );
    });

    it('rethrows other database errors', async () => {
      repo.insert.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(valid)).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    it('changes only the fields sent and keeps the SMTP password', async () => {
      queryResult.one = site(OWN_SMTP);

      await service.update('acme', { name: ' Acme Limited ' });

      expect(updated()).toMatchObject({
        name: 'Acme Limited',
        smtpHost: 'smtp.acme.test',
        smtpUser: 'mailer',
        smtpPassEncrypted: OWN_SMTP.smtpPassEncrypted,
      });
      expect(updated()).not.toHaveProperty('recipient');
      expect(updated()).not.toHaveProperty('isActive');
    });

    it('replaces the password when a new one is sent', async () => {
      queryResult.one = site(OWN_SMTP);

      await service.update('acme', { smtpPass: 'new-pass' });

      expect(box.decrypt(updated().smtpPassEncrypted!)).toBe('new-pass');
    });

    it('removes all own SMTP settings when smtpHost is cleared', async () => {
      queryResult.one = site(OWN_SMTP);

      await service.update('acme', { smtpHost: null });

      expect(updated()).toMatchObject({
        smtpHost: null,
        smtpPort: null,
        smtpSecure: false,
        smtpUser: null,
        smtpPassEncrypted: null,
        smtpFrom: null,
      });
    });

    it('removes the password when the user is removed', async () => {
      queryResult.one = site(OWN_SMTP);

      await service.update('acme', { smtpUser: '' });

      expect(updated()).toMatchObject({
        smtpUser: null,
        smtpPassEncrypted: null,
      });
    });

    it('validates the merged settings, not just the request', async () => {
      queryResult.one = site(); // no SMTP host

      await expect(
        service.update('acme', { smtpUser: 'u', smtpPass: 'p' }),
      ).rejects.toThrow('SMTP host is required');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('deactivates a site', async () => {
      await service.update('acme', { isActive: false });

      expect(updated()).toMatchObject({ isActive: false });
    });

    it.each([
      ['an empty name', { name: '' }],
      ['an invalid recipient', { recipient: 'nope' }],
    ])('rejects %s', async (_case, input) => {
      await expect(service.update('acme', input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 404 for an unknown site', async () => {
      queryResult.one = null;

      await expect(service.update('nope', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('API keys', () => {
    it('rotates to a new key, replacing the hash and the encrypted copy', async () => {
      const apiKey = await service.rotateApiKey('acme');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'acme' },
        expect.objectContaining({ apiKeyHash: hashApiKey(apiKey) }),
      );
      expect(box.decrypt(updated().apiKeyEncrypted!)).toBe(apiKey);
    });

    it('returns 404 when rotating an unknown site', async () => {
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.rotateApiKey('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reveals the current key by decrypting the stored copy', async () => {
      await expect(service.revealApiKey('acme')).resolves.toBe('sk_current');
    });

    it('returns 404 when revealing an unknown site', async () => {
      queryResult.one = null;

      await expect(service.revealApiKey('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('looks up an active site by the hash of the key', async () => {
      await service.findActiveByApiKey('sk_current');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { apiKeyHash: hashApiKey('sk_current'), isActive: true },
      });
    });
  });

  describe('getMailSettings', () => {
    it('returns null for a missing or inactive site', async () => {
      queryResult.one = null;

      await expect(service.getMailSettings('acme')).resolves.toBeNull();
    });

    it('uses the global SMTP for a site without its own host', async () => {
      await expect(service.getMailSettings('acme')).resolves.toEqual({
        siteId: 'acme',
        name: 'Acme Ltd',
        recipient: 'inbox@acme.test',
        smtp: null,
        from: null,
        cc: [],
      });
    });

    it("decrypts the site's own SMTP password", async () => {
      queryResult.one = site(OWN_SMTP);

      const settings = await service.getMailSettings('acme');

      expect(settings?.smtp).toEqual({
        host: 'smtp.acme.test',
        port: 587,
        secure: false,
        user: 'mailer',
        pass: 'acme-smtp-pass',
      });
      expect(settings?.from).toBe('Acme <no-reply@acme.test>');
    });

    it.each([
      [true, 465],
      [false, 587],
    ])('defaults the port when secure=%s to %i', async (secure, port) => {
      queryResult.one = site({
        ...OWN_SMTP,
        smtpPort: null,
        smtpSecure: secure,
      });

      const settings = await service.getMailSettings('acme');

      expect(settings?.smtp?.port).toBe(port);
    });
  });

  describe('access', () => {
    const user = (overrides: Partial<AuthUser>): AuthUser => ({
      id: 'u1',
      email: 'u@example.com',
      fullName: 'U',
      role: 'company_user',
      siteIds: ['acme'],
      ...overrides,
    });

    it('gives a company user only their own sites, without a query', async () => {
      await expect(service.accessibleSiteIds(user({}))).resolves.toEqual([
        'acme',
      ]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('gives a super-admin every site, including inactive ones', async () => {
      repo.find.mockResolvedValue([{ id: 'acme' }, { id: 'deliva' }]);

      await expect(
        service.accessibleSiteIds(user({ role: 'super_admin', siteIds: [] })),
      ).resolves.toEqual(['acme', 'deliva']);
      // No isActive filter: old requests of inactive sites stay visible.
      expect(repo.find.mock.calls[0][0]).not.toHaveProperty('where');
    });

    it('skips the query for an empty id list', async () => {
      await expect(service.namesById([])).resolves.toEqual(new Map());
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('company settings (name and sender)', () => {
    const companyUser: AuthUser = {
      id: 'u1',
      email: 'u@acme.test',
      fullName: 'U',
      role: 'company_user',
      siteIds: ['acme'],
    };

    it('updates the name and sender and reports which fields changed', async () => {
      queryResult.one = site();

      const result = await service.updateCompanySettings(companyUser, 'acme', {
        name: '  Acme Group ',
        from: 'Acme <hello@acme.test>',
      });

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'acme' },
        { name: 'Acme Group', smtpFrom: 'Acme <hello@acme.test>' },
      );
      expect(result.changed).toEqual(['name', 'smtpFrom']);
      expect(result.site).toMatchObject({
        name: 'Acme Group',
        from: 'Acme <hello@acme.test>',
        hasOwnSmtp: false,
      });
    });

    it('clears the sender back to the default with null or ""', async () => {
      queryResult.one = site({ smtpFrom: 'Acme <hello@acme.test>' });

      await service.updateCompanySettings(companyUser, 'acme', { from: '' });

      expect(repo.update).toHaveBeenCalledWith({ id: 'acme' }, { smtpFrom: null });
    });

    it('does not write when nothing changed', async () => {
      queryResult.one = site();

      const result = await service.updateCompanySettings(companyUser, 'acme', {
        name: 'Acme Ltd',
      });

      expect(repo.update).not.toHaveBeenCalled();
      expect(result.changed).toEqual([]);
    });

    it('rejects an invalid sender address', async () => {
      queryResult.one = site();

      await expect(
        service.updateCompanySettings(companyUser, 'acme', { from: 'not an address' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('keeps the sender required when the site has its own SMTP server', async () => {
      queryResult.one = site(OWN_SMTP);

      await expect(
        service.updateCompanySettings(companyUser, 'acme', { from: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('never touches SMTP credentials when changing the sender', async () => {
      queryResult.one = site(OWN_SMTP);

      const result = await service.updateCompanySettings(companyUser, 'acme', {
        from: 'Acme Sales <sales@acme.test>',
      });

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'acme' },
        { smtpFrom: 'Acme Sales <sales@acme.test>' },
      );
      expect(result.site).not.toHaveProperty('smtp');
      expect(result.site.hasOwnSmtp).toBe(true);
    });

    it("returns 404 for a site the user can't see, without loading it", async () => {
      await expect(
        service.updateCompanySettings(companyUser, 'deliva', { name: 'X' }),
      ).rejects.toThrow(new NotFoundException('Site not found'));
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('CC list', () => {
    const companyUser: AuthUser = {
      id: 'u1',
      email: 'u@acme.test',
      fullName: 'U',
      role: 'company_user',
      siteIds: ['acme'],
    };

    beforeEach(() => {
      repo.findOne.mockResolvedValue(
        site({ ccRecipients: ['old@acme.test', 'keep@acme.test'] }),
      );
    });

    it('replaces the list and reports what was added and removed', async () => {
      const result = await service.setCc(companyUser, 'acme', [
        ' Keep@Acme.test ',
        'new@acme.test',
        'new@acme.test',
      ]);

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'acme' },
        { ccRecipients: ['keep@acme.test', 'new@acme.test'] },
      );
      expect(result.added).toEqual(['new@acme.test']);
      expect(result.removed).toEqual(['old@acme.test']);
      expect(result.site.cc).toEqual(['keep@acme.test', 'new@acme.test']);
    });

    it('clears the list with []', async () => {
      await service.setCc(companyUser, 'acme', []);

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'acme' },
        { ccRecipients: [] },
      );
    });

    it("returns 404 for a site the user can't see, without loading it", async () => {
      await expect(
        service.setCc(companyUser, 'deliva', ['a@b.test']),
      ).rejects.toThrow(new NotFoundException('Site not found'));
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets a super-admin set CC on any site', async () => {
      repo.find.mockResolvedValue([{ id: 'acme' }, { id: 'deliva' }]);

      await service.setCc(
        { ...companyUser, role: 'super_admin', siteIds: [] },
        'deliva',
        ['a@deliva.test'],
      );

      expect(repo.update).toHaveBeenCalled();
    });

    it.each([
      [
        'more than 10 addresses',
        Array.from({ length: 11 }, (_, n) => `cc${n}@acme.test`),
        'At most 10 CC addresses',
      ],
      [
        'an invalid address',
        ['ok@acme.test', 'nope'],
        'Not valid email addresses: nope',
      ],
      [
        'the main recipient',
        ['INBOX@acme.test'],
        'The main recipient already gets every email',
      ],
    ])('rejects %s', async (_case, cc, message) => {
      await expect(service.setCc(companyUser, 'acme', cc)).rejects.toThrow(
        message,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("lists the user's companies without SMTP details", async () => {
      repo.find.mockResolvedValue([
        site({ ...OWN_SMTP, ccRecipients: ['x@acme.test'] }),
      ]);

      const list = await service.listForUser(companyUser);

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: In(['acme']) } }),
      );
      expect(list).toEqual([
        {
          id: 'acme',
          name: 'Acme Ltd',
          recipient: 'inbox@acme.test',
          cc: ['x@acme.test'],
          isActive: true,
        },
      ]);
      expect(JSON.stringify(list)).not.toMatch(/smtp|mailer|v1:/i);
    });

    it('returns no companies for a user without sites, without querying', async () => {
      await expect(
        service.listForUser({ ...companyUser, siteIds: [] }),
      ).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('passes the CC list to the mail settings', async () => {
      queryResult.one = site({ ccRecipients: ['x@acme.test'] });

      await expect(service.getMailSettings('acme')).resolves.toMatchObject({
        cc: ['x@acme.test'],
      });
    });
  });
});
