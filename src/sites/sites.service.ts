import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmail } from 'class-validator';
import { QueryFailedError, Repository } from 'typeorm';
import { SITE_ID_PATTERN, Site } from './entities/site.entity.js';
import { SecretBox, generateApiKey, hashApiKey } from './site-secrets.js';

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
