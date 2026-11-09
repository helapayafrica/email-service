import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Lowercase letters, digits and dashes, starting with a letter or digit.
// Websites send this as siteId, so it must stay stable once in use.
export const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,49}$/;

// A company whose website posts to /contact. Users see a site's requests via
// users.siteIds; contact_requests.siteId points here too.
//
// Columns marked select: false hold secrets and are never loaded unless a
// query asks for them explicitly (addSelect), so they can't leak into a
// response by accident.
@Entity('sites')
@Check('CHK_sites_id_slug', `"id" ~ '^[a-z0-9][a-z0-9-]{1,49}$'`)
export class Site {
  @PrimaryColumn('varchar', { length: 50 })
  id: string;

  @Column('varchar', { length: 150 })
  name: string;

  // Where this company's contact emails are delivered.
  @Column('varchar', { length: 254 })
  recipient: string;

  // SHA-256 of the API key (hashApiKey). ApiKeyGuard looks sites up by this.
  @Column('varchar', { length: 64, unique: true, select: false })
  apiKeyHash: string;

  // The same key, encrypted with SecretBox, so a super-admin can reveal it.
  @Column('text', { select: false })
  apiKeyEncrypted: string;

  // Per-company SMTP. When smtpHost is null, the global SMTP_* settings are used.
  @Column({ type: 'varchar', length: 255, nullable: true })
  smtpHost: string | null;

  @Column({ type: 'integer', nullable: true })
  smtpPort: number | null;

  @Column({ type: 'boolean', default: false })
  smtpSecure: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  smtpUser: string | null;

  // Encrypted with SecretBox; it has to be decrypted to send, so no hashing.
  @Column({ type: 'text', nullable: true, select: false })
  smtpPassEncrypted: string | null;

  // e.g. 'Deliva Fasta <no-reply@deliva.com>'. Null falls back to SMTP_FROM.
  @Column({ type: 'varchar', length: 320, nullable: true })
  smtpFrom: string | null;

  // Deactivate instead of deleting, so users.siteIds and old contact requests
  // never point at a missing site. Inactive sites reject /contact.
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
