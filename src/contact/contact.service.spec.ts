import { BadRequestException, Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import type { Repository } from 'typeorm';
import { ContactService } from './contact.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import type { ContactRequest } from './entities/contact-request.entity.js';
import type { SitesService } from '../sites/sites.service.js';

describe('ContactService', () => {
  const dto: CreateContactDto = {
    siteId: 'deliva',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phoneNumber: '+254700000000',
    company: 'Acme Ltd',
    subject: 'Partnership',
    message: 'I would like to discuss a partnership.',
  };

  let repo: {
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let queue: { add: ReturnType<typeof vi.fn> };
  let sites: { findById: ReturnType<typeof vi.fn> };
  let service: ContactService;

  beforeEach(() => {
    repo = {
      findOne: vi.fn(),
      create: vi.fn((record) => ({ id: 'contact-1', ...record })),
      save: vi.fn(),
      update: vi.fn(),
    };
    queue = { add: vi.fn() };
    sites = {
      findById: vi.fn((id: string) =>
        Promise.resolve(
          id === 'deliva'
            ? { id: 'deliva', name: 'Deliva Fasta', isActive: true }
            : null,
        ),
      ),
    };
    service = new ContactService(
      repo as unknown as Repository<ContactRequest>,
      queue as unknown as Queue,
      sites as unknown as SitesService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires an idempotency key', async () => {
    await expect(service.handleContact(dto, '')).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('returns the existing request without enqueueing a duplicate', async () => {
    repo.findOne.mockResolvedValue({ id: 'existing-1', status: 'sent' });

    await expect(service.handleContact(dto, 'same-key')).resolves.toEqual({
      success: true,
      message:
        'Your message was already received. No duplicate submission was created.',
      requestId: 'existing-1',
      status: 'accepted',
      duplicate: true,
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns immediately after persistence without waiting for Redis', async () => {
    repo.findOne.mockResolvedValue(null);
    queue.add.mockReturnValue(new Promise(() => undefined));

    await expect(service.handleContact(dto, 'unique-key')).resolves.toEqual({
      success: true,
      message:
        'Thank you. Your message has been received and will be delivered shortly.',
      requestId: 'contact-1',
      status: 'accepted',
      duplicate: false,
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'unique-key',
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        status: 'queued',
      }),
    );
    expect(repo.save).toHaveBeenCalledOnce();
    // Recipient and SMTP settings are loaded by MailProcessor, not queued.
    expect(queue.add.mock.calls[0][1]).not.toHaveProperty('to');
    expect(queue.add).toHaveBeenCalledWith(
      'send-contact-email',
      expect.objectContaining({
        contactId: 'contact-1',
        receivedAt: expect.any(String),
        sourceName: 'Deliva Fasta',
        siteId: 'deliva',
      }),
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      }),
    );
  });

  it('marks the contact failed when it cannot be queued', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    repo.findOne.mockResolvedValue(null);
    queue.add.mockRejectedValue(new Error('Redis unavailable'));

    await service.handleContact(dto, 'queue-failure-key');
    await vi.waitFor(() => {
      expect(repo.update).toHaveBeenCalledWith('contact-1', {
        status: 'failed',
      });
    });
  });

  it('rejects a site that is not configured', async () => {
    repo.findOne.mockResolvedValue(null);
    const unknownSiteDto = Object.assign(new CreateContactDto(), dto, {
      siteId: 'unknown',
    });

    await expect(
      service.handleContact(unknownSiteDto, 'unique-key'),
    ).rejects.toThrow('Unknown or unconfigured site');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects a deactivated site', async () => {
    repo.findOne.mockResolvedValue(null);
    sites.findById.mockResolvedValue({ id: 'deliva', isActive: false });

    await expect(service.handleContact(dto, 'unique-key')).rejects.toThrow(
      'Unknown or unconfigured site',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});
