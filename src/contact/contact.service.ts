import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  ContactRequest,
  MAX_DELIVERY_ATTEMPTS,
} from './entities/contact-request.entity.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { SitesService } from '../sites/sites.service.js';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(ContactRequest)
    private readonly repo: Repository<ContactRequest>,
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly sites: SitesService,
  ) {}

  async handleContact(dto: CreateContactDto, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const existing = await this.repo.findOne({ where: { idempotencyKey } });
    if (existing) {
      this.logger.log(
        `Contact request duplicate requestId=${existing.id} status=${existing.status}`,
      );
      return {
        success: true,
        message:
          'Your message was already received. No duplicate submission was created.',
        requestId: existing.id,
        status: 'accepted' as const,
        duplicate: true,
      };
    }

    // ApiKeyGuard already matched the key to this site; this also covers a
    // site deactivated in between, and callers that skip the guard.
    const site = await this.sites.findById(dto.siteId);
    if (!site || !site.isActive) {
      throw new BadRequestException('Unknown or unconfigured site');
    }

    const record = this.repo.create({
      idempotencyKey,
      siteId: dto.siteId,
      fullName: dto.fullName,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      company: dto.company,
      subject: dto.subject,
      message: dto.message,
      status: 'queued',
    });
    await this.repo.save(record);
    this.logger.log(
      `Contact request accepted requestId=${record.id} siteId=${record.siteId} status=${record.status}`,
    );

    void this.enqueueContactEmail(
      record.id,
      record.createdAt ?? new Date(),
      dto,
      site.name,
    ).catch(async (error: unknown) => {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Unable to queue contact email ${record.id}; marking it failed`,
        stack,
      );
      await this.markFailed(record.id, {
        attempts: 0,
        error: 'Could not be queued for delivery',
      });
    });

    return {
      success: true,
      message:
        'Thank you. Your message has been received and will be delivered shortly.',
      requestId: record.id,
      status: 'accepted' as const,
      duplicate: false,
    };
  }

  private async enqueueContactEmail(
    contactId: string,
    receivedAt: Date,
    dto: CreateContactDto,
    sourceName: string,
  ): Promise<void> {
    const job = await this.mailQueue.add(
      'send-contact-email',
      {
        contactId,
        receivedAt: receivedAt.toISOString(),
        // The recipient and SMTP settings are not in the job: MailProcessor
        // loads them from the sites table when it sends, so SMTP credentials
        // never sit in Redis.
        sourceName,
        from: dto.email,
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
        company: dto.company,
        subject: `[${sourceName}] ${dto.subject || 'New contact request'}`,
        message: dto.message,
        siteId: dto.siteId,
      },
      {
        attempts: MAX_DELIVERY_ATTEMPTS,
        // Initial attempt plus retries after 2, 4, 8, and 16 seconds.
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log(
      `Contact email queued requestId=${contactId} jobId=${String(job.id)} siteId=${dto.siteId} attempts=${MAX_DELIVERY_ATTEMPTS}`,
    );
  }

  // Delivery bookkeeping for MailProcessor. Times use the database clock
  // (now()), the same one createdAt uses, so they line up whatever the app
  // server's time zone.
  markSent(
    id: string,
    delivery: { to: string; cc: string[]; attempts: number },
  ) {
    return this.repo.update(id, {
      status: 'sent',
      deliveredTo: delivery.to,
      ccTo: delivery.cc,
      attempts: delivery.attempts,
      sentAt: () => 'now()',
      lastAttemptAt: () => 'now()',
      lastError: null,
    });
  }

  // Skips a request whose delivery was stopped while this attempt was in
  // flight, so the status stays 'cancelled'.
  // True when a dashboard user stopped delivery; the processor then skips
  // sending, which ends the job without further retries.
  async isCancelled(id: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { id }, select: { id: true, status: true } });
    return row?.status === 'cancelled';
  }

  markFailed(id: string, failure: { attempts: number; error: string }) {
    return this.repo.update({ id, status: Not('cancelled') }, {
      status: 'failed',
      attempts: failure.attempts,
      lastAttemptAt: () => 'now()',
      // One line, and short enough for the column.
      lastError: failure.error.replace(/\s+/g, ' ').trim().slice(0, 500),
    });
  }
}
