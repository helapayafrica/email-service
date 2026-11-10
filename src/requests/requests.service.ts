import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import {
  ContactRequest,
  MAX_DELIVERY_ATTEMPTS,
} from '../contact/entities/contact-request.entity.js';
import { SitesService } from '../sites/sites.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import type { ListRequestsQuery } from './dto/list-requests.query.js';

// What the dashboard sees. idempotencyKey is internal and left out.
export interface RequestView {
  id: string;
  siteId: string;
  siteName: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  company: string | null;
  subject: string | null;
  message: string;
  status: ContactRequest['status'];
  createdAt: Date;
  // Where the email went and how delivery went. Empty for requests from
  // before delivery tracking. status 'failed' with attempts below
  // MAX_DELIVERY_ATTEMPTS means it will still be retried.
  delivery: {
    deliveredTo: string | null;
    cc: string[];
    sentAt: Date | null;
    attempts: number;
    maxAttempts: number;
    willRetry: boolean;
    lastAttemptAt: Date | null;
    lastError: string | null;
  };
}

export interface RequestPage {
  items: RequestView[];
  total: number;
  page: number;
  limit: number;
}

function toView(row: ContactRequest, names: Map<string, string>): RequestView {
  return {
    id: row.id,
    siteId: row.siteId,
    siteName: names.get(row.siteId) ?? row.siteId,
    fullName: row.fullName,
    email: row.email,
    phoneNumber: row.phoneNumber,
    company: row.company,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    delivery: {
      deliveredTo: row.deliveredTo,
      cc: row.ccTo,
      sentAt: row.sentAt,
      attempts: row.attempts,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
      willRetry:
        row.status === 'failed' &&
        row.attempts > 0 &&
        row.attempts < MAX_DELIVERY_ATTEMPTS,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
    },
  };
}

// Makes % and _ in the user's search match literally instead of as wildcards.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(ContactRequest)
    private readonly requests: Repository<ContactRequest>,
    private readonly sites: SitesService,
  ) {}

  async list(user: AuthUser, query: ListRequestsQuery): Promise<RequestPage> {
    const { page, limit } = query;

    let siteIds = await this.sites.accessibleSiteIds(user);
    if (query.siteId !== undefined) {
      // 404 rather than 403: don't confirm that another company's site exists.
      if (!siteIds.includes(query.siteId)) {
        throw new NotFoundException('Site not found');
      }
      siteIds = [query.siteId];
    }

    // "IN ()" is a SQL syntax error, and no sites means no rows anyway.
    if (siteIds.length === 0) {
      return { items: [], total: 0, page, limit };
    }

    const qb = this.requests
      .createQueryBuilder('r')
      .where('r.siteId IN (:...siteIds)', { siteIds });

    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }

    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      qb.andWhere(
        new Brackets((or) => {
          or.where('r.fullName ILIKE :pattern', { pattern })
            .orWhere('r.email ILIKE :pattern', { pattern })
            .orWhere('r.subject ILIKE :pattern', { pattern });
        }),
      );
    }

    const [rows, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      // Tie-breaker so paging is stable when two rows share a timestamp.
      .addOrderBy('r.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const names = await this.sites.namesById(rows.map((row) => row.siteId));
    return {
      items: rows.map((row) => toView(row, names)),
      total,
      page,
      limit,
    };
  }

  async findOne(user: AuthUser, id: string): Promise<RequestView> {
    const siteIds = await this.sites.accessibleSiteIds(user);
    // The site filter is part of the lookup, so another tenant's row and a
    // missing row both come back as null and look identical to the caller.
    const row =
      siteIds.length === 0
        ? null
        : await this.requests.findOne({ where: { id, siteId: In(siteIds) } });
    if (!row) {
      throw new NotFoundException('Contact request not found');
    }
    return toView(row, await this.sites.namesById([row.siteId]));
  }
}
