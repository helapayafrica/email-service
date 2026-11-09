import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { ContactRequest } from '../contact/entities/contact-request.entity.js';
import { getSiteName } from '../config/sites.config.js';
import type { AuthUser } from '../auth/auth-user.js';
import { accessibleSiteIds, canAccessSite } from '../auth/site-access.js';
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
}

export interface RequestPage {
  items: RequestView[];
  total: number;
  page: number;
  limit: number;
}

function toView(row: ContactRequest): RequestView {
  return {
    id: row.id,
    siteId: row.siteId,
    siteName: getSiteName(row.siteId),
    fullName: row.fullName,
    email: row.email,
    phoneNumber: row.phoneNumber,
    company: row.company,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
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
  ) {}

  async list(user: AuthUser, query: ListRequestsQuery): Promise<RequestPage> {
    const { page, limit } = query;

    let siteIds = accessibleSiteIds(user);
    if (query.siteId !== undefined) {
      // 404 rather than 403: don't confirm that another company's site exists.
      if (!canAccessSite(user, query.siteId)) {
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

    return { items: rows.map(toView), total, page, limit };
  }

  async findOne(user: AuthUser, id: string): Promise<RequestView> {
    const siteIds = accessibleSiteIds(user);
    // The site filter is part of the lookup, so another tenant's row and a
    // missing row both come back as null and look identical to the caller.
    const row =
      siteIds.length === 0
        ? null
        : await this.requests.findOne({ where: { id, siteId: In(siteIds) } });
    if (!row) {
      throw new NotFoundException('Contact request not found');
    }
    return toView(row);
  }
}
