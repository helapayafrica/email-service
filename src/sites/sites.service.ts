import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmail } from 'class-validator';
import { In, QueryFailedError, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user.js';
import { SITE_ID_PATTERN, Site } from './entities/site.entity.js';
import { SecretBox, generateApiKey, hashApiKey } from './site-secrets.js';

export interface SiteSmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
}

export interface SiteMailSettings {
  siteId: string;
  name: string;
  recipient: string;
  // null: send through the global SMTP_* transport.
  smtp: SiteSmtpSettings | null;
  // From address override; null falls back to SMTP_FROM.
  from: string | null;
}

export interface SiteSmtpInput {
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null;
  smtpFrom?: string | null;
}

export interface CreateSiteInput extends SiteSmtpInput {
  id: string;
  name: string;
  recipient: string;
  // Only for importing a site whose key is already deployed on its website.
  // Normally omitted, and a new key is generated.
  apiKey?: string;
}

export interface CreatedSite {
  site: Site;
  // The plaintext key. Show it to the super-admin; it is also stored
  // encrypted and can be revealed again later.
  apiKey: string;
}

const MIN_IMPORTED_API_KEY_LENGTH = 16;

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueViolation(error: unknown): error is QueryFailedError {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  );
}

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site) private readonly repo: Repository<Site>,
    private readonly secrets: SecretBox,
  ) {}

  findById(id: string): Promise<Site | null> {
    return this.repo.findOne({ where: { id } });
  }

  // Used by ApiKeyGuard. Looks the site up by the key's hash, so the key is
  // never decrypted and no per-site comparison loop is needed.
  findActiveByApiKey(apiKey: string): Promise<Site | null> {
    return this.repo.findOne({
      where: { apiKeyHash: hashApiKey(apiKey), isActive: true },
    });
  }

  list(): Promise<Site[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  // Includes inactive sites: their old requests stay visible in the dashboard.
  async listIds(): Promise<string[]> {
    const rows = await this.repo.find({
      select: { id: true },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  }

  // The sites a dashboard user may see. Super-admins see every site;
  // everyone else sees the sites in users.siteIds.
  async accessibleSiteIds(user: AuthUser): Promise<string[]> {
    return user.role === 'super_admin' ? this.listIds() : user.siteIds;
  }

  // id -> display name, for the given ids. Ids with no site row are left
  // out; callers fall back to showing the id itself.
  async namesById(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.repo.find({
      select: { id: true, name: true },
      where: { id: In(unique) },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  // Which of the given ids exist as sites (used to validate users.siteIds).
  async existingIds(ids: string[]): Promise<string[]> {
    const names = await this.namesById(ids);
    return [...names.keys()];
  }

  // Everything MailProcessor needs to deliver one site's email. This is the
  // only place the SMTP password is decrypted. Returns null for a missing
  // or inactive site.
  async getMailSettings(id: string): Promise<SiteMailSettings | null> {
    const site = await this.repo
      .createQueryBuilder('site')
      .addSelect('site.smtpPassEncrypted')
      .where('site.id = :id', { id })
      .andWhere('site.isActive = true')
      .getOne();
    if (!site) return null;

    return {
      siteId: site.id,
      name: site.name,
      recipient: site.recipient,
      smtp: site.smtpHost
        ? {
            host: site.smtpHost,
            port: site.smtpPort ?? (site.smtpSecure ? 465 : 587),
            secure: site.smtpSecure,
            user: site.smtpUser,
            pass: site.smtpPassEncrypted
              ? this.secrets.decrypt(site.smtpPassEncrypted)
              : null,
          }
        : null,
      from: site.smtpFrom,
    };
  }

  async create(input: CreateSiteInput): Promise<CreatedSite> {
    const id = input.id.trim();
    const name = input.name.trim();
    const recipient = input.recipient.trim();

    if (!SITE_ID_PATTERN.test(id)) {
      throw new BadRequestException(
        'Site id must be 2-50 characters: lowercase letters, digits and dashes, not starting with a dash',
      );
    }
    if (!name || name.length > 150) {
      throw new BadRequestException('Name is required (max 150 characters)');
    }
    if (!isEmail(recipient)) {
      throw new BadRequestException('Recipient must be an email address');
    }

    let apiKey = generateApiKey();
    if (input.apiKey !== undefined) {
      apiKey = input.apiKey.trim();
      if (apiKey.length < MIN_IMPORTED_API_KEY_LENGTH) {
        throw new BadRequestException(
          `API key must be at least ${MIN_IMPORTED_API_KEY_LENGTH} characters`,
        );
      }
    }

    const smtp = this.prepareSmtp(input);

    try {
      // insert, not save: with a hand-picked primary key, save() would
      // silently overwrite an existing site that has the same id.
      await this.repo.insert({
        id,
        name,
        recipient,
        apiKeyHash: hashApiKey(apiKey),
        apiKeyEncrypted: this.secrets.encrypt(apiKey),
        ...smtp,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = (error.driverError as { constraint?: string })
          .constraint;
        throw new ConflictException(
          constraint?.startsWith('PK_')
            ? `A site with id ${id} already exists`
            : 'That API key is already used by another site',
        );
      }
      throw error;
    }

    return { site: await this.repo.findOneByOrFail({ id }), apiKey };
  }

  // Validates and normalises the SMTP fields and encrypts the password.
  private prepareSmtp(input: SiteSmtpInput) {
    const smtpHost = emptyToNull(input.smtpHost);
    const smtpUser = emptyToNull(input.smtpUser);
    const smtpFrom = emptyToNull(input.smtpFrom);
    const smtpPass = input.smtpPass ? input.smtpPass : null;
    const smtpPort = input.smtpPort ?? null;

    if (
      smtpPort !== null &&
      (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    ) {
      throw new BadRequestException('SMTP port must be between 1 and 65535');
    }
    if (!smtpHost && (smtpUser || smtpPass || smtpPort !== null)) {
      throw new BadRequestException(
        'SMTP host is required when other SMTP settings are given',
      );
    }
    if (smtpPass && !smtpUser) {
      throw new BadRequestException('SMTP password needs an SMTP user');
    }
    // A company's own mail server will usually refuse (or SPF will fail) a
    // From address on another domain, so don't fall back to SMTP_FROM here.
    if (smtpHost && !smtpFrom) {
      throw new BadRequestException(
        'SMTP From address is required when an SMTP host is set',
      );
    }

    return {
      smtpHost,
      smtpPort,
      smtpSecure: input.smtpSecure ?? false,
      smtpUser,
      smtpPassEncrypted: smtpPass ? this.secrets.encrypt(smtpPass) : null,
      smtpFrom,
    };
  }
}
