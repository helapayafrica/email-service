import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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

// SMTP fields as sent by a super-admin. For updates: a field left out
// (undefined) keeps its current value; null or '' clears it. Clearing
// smtpHost removes the site's own SMTP settings entirely, so it goes back to
// the global SMTP_* settings.
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

export interface UpdateSiteInput extends SiteSmtpInput {
  name?: string;
  recipient?: string;
  isActive?: boolean;
}

// What super-admins see. Never contains the API key, its hash, or the SMTP
// password; hasPassword only says whether one is stored.
export interface SiteView {
  id: string;
  name: string;
  recipient: string;
  isActive: boolean;
  // null: the global SMTP_FROM is used.
  from: string | null;
  // null: the global SMTP_* server is used.
  smtp: {
    host: string;
    port: number | null;
    secure: boolean;
    user: string | null;
    hasPassword: boolean;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedSite {
  site: SiteView;
  // The plaintext key. Shown to the super-admin now; it is also stored
  // encrypted and can be revealed again later.
  apiKey: string;
}

// The SMTP columns as stored.
type StoredSmtp = Pick<
  Site,
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpSecure'
  | 'smtpUser'
  | 'smtpPassEncrypted'
  | 'smtpFrom'
>;

const NO_SMTP: StoredSmtp = {
  smtpHost: null,
  smtpPort: null,
  smtpSecure: false,
  smtpUser: null,
  smtpPassEncrypted: null,
  smtpFrom: null,
};

const MIN_IMPORTED_API_KEY_LENGTH = 16;

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// 'Acme Ltd <no-reply@acme.com>' -> 'no-reply@acme.com'; a bare address is
// returned as is.
function addressPart(from: string): string {
  const match = /<([^<>]+)>\s*$/.exec(from);
  return (match ? match[1] : from).trim();
}

function isUniqueViolation(error: unknown): error is QueryFailedError {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  );
}

function validName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 150) {
    throw new BadRequestException('Name is required (max 150 characters)');
  }
  return name;
}

function validRecipient(value: string): string {
  const recipient = value.trim();
  if (!isEmail(recipient) || recipient.length > 254) {
    throw new BadRequestException('Recipient must be an email address');
  }
  return recipient;
}

function toView(site: Site): SiteView {
  return {
    id: site.id,
    name: site.name,
    recipient: site.recipient,
    isActive: site.isActive,
    from: site.smtpFrom,
    smtp: site.smtpHost
      ? {
          host: site.smtpHost,
          port: site.smtpPort,
          secure: site.smtpSecure,
          user: site.smtpUser,
          hasPassword: Boolean(site.smtpPassEncrypted),
        }
      : null,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
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

  // ---- Super-admin management -------------------------------------------

  async listViews(): Promise<SiteView[]> {
    const sites = await this.repo
      .createQueryBuilder('site')
      .addSelect('site.smtpPassEncrypted') // only to compute hasPassword
      .orderBy('site.name', 'ASC')
      .getMany();
    return sites.map(toView);
  }

  async getView(id: string): Promise<SiteView> {
    return toView(await this.loadForUpdate(id));
  }

  async create(input: CreateSiteInput): Promise<CreatedSite> {
    const id = input.id.trim();
    if (!SITE_ID_PATTERN.test(id)) {
      throw new BadRequestException(
        'Site id must be 2-50 characters: lowercase letters, digits and dashes, not starting with a dash',
      );
    }
    const name = validName(input.name);
    const recipient = validRecipient(input.recipient);

    let apiKey = generateApiKey();
    if (input.apiKey !== undefined) {
      apiKey = input.apiKey.trim();
      if (apiKey.length < MIN_IMPORTED_API_KEY_LENGTH) {
        throw new BadRequestException(
          `API key must be at least ${MIN_IMPORTED_API_KEY_LENGTH} characters`,
        );
      }
    }

    const smtp = this.mergeSmtp(NO_SMTP, input);

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

    return { site: await this.getView(id), apiKey };
  }

  // The id can't change: websites send it, and contact_requests.siteId and
  // users.siteIds refer to it.
  async update(id: string, input: UpdateSiteInput): Promise<SiteView> {
    const current = await this.loadForUpdate(id);

    const changes: Partial<Site> = this.mergeSmtp(current, input);
    if (input.name !== undefined) changes.name = validName(input.name);
    if (input.recipient !== undefined) {
      changes.recipient = validRecipient(input.recipient);
    }
    if (input.isActive !== undefined) changes.isActive = input.isActive;

    await this.repo.update({ id }, changes);
    return this.getView(id);
  }

  // Issues a new key. The old key stops working immediately, so the website
  // must be updated with the new one.
  async rotateApiKey(id: string): Promise<string> {
    const apiKey = generateApiKey();
    const result = await this.repo.update(
      { id },
      {
        apiKeyHash: hashApiKey(apiKey),
        apiKeyEncrypted: this.secrets.encrypt(apiKey),
      },
    );
    if (!result.affected) throw new NotFoundException('Site not found');
    return apiKey;
  }

  async revealApiKey(id: string): Promise<string> {
    const site = await this.repo
      .createQueryBuilder('site')
      .addSelect('site.apiKeyEncrypted')
      .where('site.id = :id', { id })
      .getOne();
    if (!site) throw new NotFoundException('Site not found');
    return this.secrets.decrypt(site.apiKeyEncrypted);
  }

  private async loadForUpdate(id: string): Promise<Site> {
    const site = await this.repo
      .createQueryBuilder('site')
      .addSelect('site.smtpPassEncrypted')
      .where('site.id = :id', { id })
      .getOne();
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  // Applies the SMTP fields in `input` on top of `current`, validates the
  // result as a whole, and encrypts a new password. Validating the merged
  // state (not just the request) catches e.g. a password sent for a site
  // that has no SMTP host.
  private mergeSmtp(current: StoredSmtp, input: SiteSmtpInput): StoredSmtp {
    const clearingHost =
      input.smtpHost !== undefined && !emptyToNull(input.smtpHost);
    const base = clearingHost ? NO_SMTP : current;

    const next: StoredSmtp = {
      smtpHost:
        input.smtpHost !== undefined
          ? emptyToNull(input.smtpHost)
          : base.smtpHost,
      smtpPort: input.smtpPort !== undefined ? input.smtpPort : base.smtpPort,
      smtpSecure: input.smtpSecure ?? base.smtpSecure,
      smtpUser:
        input.smtpUser !== undefined
          ? emptyToNull(input.smtpUser)
          : base.smtpUser,
      smtpPassEncrypted:
        input.smtpPass === undefined
          ? base.smtpPassEncrypted
          : input.smtpPass
            ? this.secrets.encrypt(input.smtpPass)
            : null,
      smtpFrom:
        input.smtpFrom !== undefined
          ? emptyToNull(input.smtpFrom)
          : base.smtpFrom,
    };
    // A password without a user is never used; removing the user removes it.
    if (!next.smtpUser && input.smtpPass === undefined) {
      next.smtpPassEncrypted = null;
    }

    const { smtpHost, smtpPort, smtpUser, smtpPassEncrypted, smtpFrom } = next;
    if (
      smtpPort !== null &&
      (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    ) {
      throw new BadRequestException('SMTP port must be between 1 and 65535');
    }
    if (!smtpHost && (smtpUser || smtpPassEncrypted || smtpPort !== null)) {
      throw new BadRequestException(
        'SMTP host is required when other SMTP settings are given',
      );
    }
    if (smtpPassEncrypted && !smtpUser) {
      throw new BadRequestException('SMTP password needs an SMTP user');
    }
    if (smtpFrom && !isEmail(addressPart(smtpFrom))) {
      throw new BadRequestException(
        'SMTP From must be an email address, optionally with a name: "Acme Ltd <no-reply@acme.com>"',
      );
    }
    // A company's own mail server will usually refuse (or SPF will fail) a
    // From address on another domain, so don't fall back to SMTP_FROM here.
    if (smtpHost && !smtpFrom) {
      throw new BadRequestException(
        'SMTP From address is required when an SMTP host is set',
      );
    }
    return next;
  }
}
