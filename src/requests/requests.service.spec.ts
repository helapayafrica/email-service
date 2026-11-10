import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Brackets, In, type Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user.js';
import type { ContactRequest } from '../contact/entities/contact-request.entity.js';
import type { SitesService } from '../sites/sites.service.js';
import type { ListRequestsQuery } from './dto/list-requests.query.js';
import { RequestsService } from './requests.service.js';

const companyUser: AuthUser = {
  id: 'u1',
  email: 'jane@deliva.com',
  fullName: 'Jane',
  role: 'company_user',
  siteIds: ['deliva'],
};
const superAdmin: AuthUser = {
  ...companyUser,
  id: 'admin',
  role: 'super_admin',
  siteIds: [],
};

function row(overrides: Partial<ContactRequest> = {}): ContactRequest {
  return {
    id: 'r1',
    idempotencyKey: 'secret-idempotency-key',
    siteId: 'deliva',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phoneNumber: '+254700000000',
    company: null,
    subject: 'Hello',
    message: 'Message body',
    status: 'sent',
    createdAt: new Date('2026-11-09T10:00:00Z'),
    deliveredTo: 'inbox@deliva.test',
    ccTo: ['boss@deliva.test'],
    sentAt: new Date('2026-11-09T10:00:05Z'),
    attempts: 1,
    lastAttemptAt: new Date('2026-11-09T10:00:05Z'),
    lastError: null,
    ...overrides,
  };
}

describe('RequestsService', () => {
  let qb: Record<string, ReturnType<typeof vi.fn>>;
  let repo: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let sites: {
    accessibleSiteIds: ReturnType<typeof vi.fn>;
    namesById: ReturnType<typeof vi.fn>;
  };
  let service: RequestsService;

  beforeEach(() => {
    qb = {};
    for (const method of [
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[method] = vi.fn(() => qb);
    }
    qb.getManyAndCount = vi.fn().mockResolvedValue([[row()], 1]);
    repo = {
      createQueryBuilder: vi.fn(() => qb),
      findOne: vi.fn().mockResolvedValue(row()),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    sites = {
      // Same rule as SitesService: super-admins see every site.
      accessibleSiteIds: vi.fn((user: AuthUser) =>
        Promise.resolve(
          user.role === 'super_admin'
            ? ['alumni', 'deliva', 'voltic']
            : user.siteIds,
        ),
      ),
      namesById: vi
        .fn()
        .mockResolvedValue(new Map([['deliva', 'Deliva Fasta']])),
    };
    service = new RequestsService(
      repo as unknown as Repository<ContactRequest>,
      sites as unknown as SitesService,
    );
  });

  const query = (overrides: Partial<ListRequestsQuery> = {}) =>
    ({ page: 1, limit: 20, ...overrides }) as ListRequestsQuery;

  // The site ids the list query was scoped to.
  const scopedTo = () =>
    (qb.where.mock.calls[0][1] as { siteIds: string[] }).siteIds;

  describe('list', () => {
    it('scopes a company user to their own sites', async () => {
      await service.list(companyUser, query());

      expect(qb.where).toHaveBeenCalledWith('r.siteId IN (:...siteIds)', {
        siteIds: ['deliva'],
      });
    });

    it('gives a super-admin every site', async () => {
      await service.list(superAdmin, query());

      expect(scopedTo()).toEqual(['alumni', 'deliva', 'voltic']);
    });

    it('narrows to one of the user’s sites when siteId is given', async () => {
      await service.list(superAdmin, query({ siteId: 'voltic' }));

      expect(scopedTo()).toEqual(['voltic']);
    });

    it.each(['voltic', 'does-not-exist'])(
      'returns 404 for a siteId outside the user’s sites (%s), without querying',
      async (siteId) => {
        await expect(
          service.list(companyUser, query({ siteId })),
        ).rejects.toThrow(new NotFoundException('Site not found'));
        expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      },
    );

    it('returns an empty page for a user with no sites, without querying', async () => {
      await expect(
        service.list({ ...companyUser, siteIds: [] }, query({ page: 2 })),
      ).resolves.toEqual({ items: [], total: 0, page: 2, limit: 20 });
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('filters by status', async () => {
      await service.list(companyUser, query({ status: 'failed' }));

      expect(qb.andWhere).toHaveBeenCalledWith('r.status = :status', {
        status: 'failed',
      });
    });

    it('filters by received date, from inclusive and to exclusive', async () => {
      await service.list(companyUser, query({
        from: '2026-11-03T00:00:00.000Z',
        to: '2026-11-10T00:00:00.000Z',
      }));

      expect(qb.andWhere).toHaveBeenCalledWith('r.createdAt >= :from', {
        from: new Date('2026-11-03T00:00:00.000Z'),
      });
      expect(qb.andWhere).toHaveBeenCalledWith('r.createdAt < :to', {
        to: new Date('2026-11-10T00:00:00.000Z'),
      });
    });

    it('rejects a date range that ends before it starts', async () => {
      await expect(
        service.list(companyUser, query({
          from: '2026-11-10T00:00:00.000Z',
          to: '2026-11-03T00:00:00.000Z',
        })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('searches name, email and subject, matching % and _ literally', async () => {
      await service.list(companyUser, query({ q: '100%_off' }));

      const brackets = qb.andWhere.mock.calls[0][0] as Brackets;
      expect(brackets).toBeInstanceOf(Brackets);
      const inner = { where: vi.fn(), orWhere: vi.fn() };
      inner.where.mockReturnValue(inner);
      inner.orWhere.mockReturnValue(inner);
      brackets.whereFactory(inner as never);

      const pattern = { pattern: '%100\\%\\_off%' };
      expect(inner.where).toHaveBeenCalledWith(
        'r.fullName ILIKE :pattern',
        pattern,
      );
      expect(inner.orWhere).toHaveBeenCalledWith(
        'r.email ILIKE :pattern',
        pattern,
      );
      expect(inner.orWhere).toHaveBeenCalledWith(
        'r.subject ILIKE :pattern',
        pattern,
      );
    });

    it('pages newest first with a stable tie-breaker', async () => {
      await service.list(companyUser, query({ page: 3, limit: 10 }));

      expect(qb.orderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('r.id', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(20);
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('adds site names and leaves out the idempotency key', async () => {
      qb.getManyAndCount.mockResolvedValue([
        [row(), row({ id: 'r2', siteId: 'gone' })],
        2,
      ]);

      const page = await service.list(superAdmin, query());

      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.siteName)).toEqual([
        'Deliva Fasta',
        'gone', // no site row: falls back to the id
      ]);
      expect(page.items[0]).not.toHaveProperty('idempotencyKey');
      expect(JSON.stringify(page)).not.toContain('secret-idempotency-key');
    });
  });

  describe('findOne', () => {
    it('looks the request up only within the user’s sites', async () => {
      await service.findOne(companyUser, 'r1');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'r1', siteId: In(['deliva']) },
      });
    });

    it('returns 404 for a request on another site, same as a missing one', async () => {
      // Another tenant's row doesn't match the site filter, so the database
      // returns nothing.
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne(companyUser, 'r-voltic')).rejects.toThrow(
        new NotFoundException('Contact request not found'),
      );
    });

    it('returns 404 for a user with no sites, without querying', async () => {
      await expect(
        service.findOne({ ...companyUser, siteIds: [] }, 'r1'),
      ).rejects.toThrow(NotFoundException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('lets a super-admin read a request on any site', async () => {
      await service.findOne(superAdmin, 'r1');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'r1', siteId: In(['alumni', 'deliva', 'voltic']) },
      });
    });

    it('returns the view without the idempotency key', async () => {
      const view = await service.findOne(companyUser, 'r1');

      expect(view).toMatchObject({ id: 'r1', siteName: 'Deliva Fasta' });
      expect(view).not.toHaveProperty('idempotencyKey');
    });
  });

  describe('stopDelivery', () => {
    it.each([
      ['queued', { status: 'queued', attempts: 0 }],
      ['pending', { status: 'pending', attempts: 0 }],
      ['failed with attempts left', { status: 'failed', attempts: 2 }],
    ] as const)('stops a request that is %s', async (_label, state) => {
      repo.findOne
        .mockResolvedValueOnce(row({ ...state, sentAt: null, deliveredTo: null }))
        .mockResolvedValueOnce(row({ ...state, status: 'cancelled', sentAt: null, deliveredTo: null }));

      const view = await service.stopDelivery(companyUser, 'r1');

      expect(repo.update).toHaveBeenCalledWith(
        [
          { id: 'r1', status: In(['pending', 'queued']) },
          expect.objectContaining({ id: 'r1', status: 'failed' }),
        ],
        { status: 'cancelled' },
      );
      expect(view.status).toBe('cancelled');
      expect(view.delivery.canStop).toBe(false);
      expect(view.delivery.willRetry).toBe(false);
    });

    it('refuses a request that was already sent', async () => {
      repo.findOne.mockResolvedValue(row());

      await expect(service.stopDelivery(companyUser, 'r1')).rejects.toThrow(
        new ConflictException('This email has already been sent'),
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses a request that failed for good or was already stopped', async () => {
      for (const state of [
        { status: 'failed', attempts: 5 },
        { status: 'cancelled', attempts: 1 },
      ] as const) {
        repo.findOne.mockResolvedValue(row(state));
        await expect(service.stopDelivery(companyUser, 'r1')).rejects.toThrow(
          new ConflictException('Delivery has already stopped'),
        );
      }
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns 409 when delivery finished between the read and the update', async () => {
      repo.findOne.mockResolvedValue(row({ status: 'queued', attempts: 0 }));
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.stopDelivery(companyUser, 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("returns 404 for a request on another company's site", async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.stopDelivery(companyUser, 'r1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('delivery record', () => {
    const deliveryOf = async (overrides: Partial<ContactRequest>) => {
      repo.findOne.mockResolvedValue(row(overrides));
      return (await service.findOne(companyUser, 'r1')).delivery;
    };

    it('shows where and when a sent email was delivered', async () => {
      await expect(deliveryOf({})).resolves.toEqual({
        deliveredTo: 'inbox@deliva.test',
        cc: ['boss@deliva.test'],
        sentAt: new Date('2026-11-09T10:00:05Z'),
        attempts: 1,
        maxAttempts: 5,
        willRetry: false,
        canStop: false,
        lastAttemptAt: new Date('2026-11-09T10:00:05Z'),
        lastError: null,
      });
    });

    it.each([
      ['a failure that is still being retried', 2, true],
      ['a failure after the last attempt', 5, false],
      ['a request that could not be queued', 0, false],
    ])('reports willRetry for %s', async (_case, attempts, willRetry) => {
      const delivery = await deliveryOf({
        status: 'failed',
        attempts,
        deliveredTo: null,
        sentAt: null,
        lastError: 'EAUTH (535): Invalid login',
      });

      expect(delivery).toMatchObject({
        willRetry,
        lastError: 'EAUTH (535): Invalid login',
      });
    });
  });
});
