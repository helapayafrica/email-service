import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const CONTACT_REQUEST_STATUSES = [
  'pending',
  'queued',
  'sent',
  'failed',
  // A dashboard user stopped delivery before it succeeded; no more attempts.
  'cancelled',
] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

// Bull job attempts per email: one initial try plus 4 retries.
export const MAX_DELIVERY_ATTEMPTS = 5;

@Index('IDX_contact_requests_siteId_createdAt', ['siteId', 'createdAt'])
@Entity('contact_requests')
export class ContactRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  idempotencyKey: string;

  @Column()
  siteId: string;

  @Column({ length: 150 })
  fullName: string;

  @Column({ length: 254 })
  email: string;

  @Column({ length: 30 })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subject: string | null;

  @Column('text')
  message: string;

  @Column({ default: 'pending' })
  status: ContactRequestStatus;

  @CreateDateColumn()
  createdAt: Date;

  // ---- Delivery record, written by MailProcessor ----------------------------
  // Rows from before delivery tracking have these empty (attempts = 0).

  // The address the email was delivered to (the site's recipient at the time).
  @Column({ type: 'varchar', length: 254, nullable: true })
  deliveredTo: string | null;

  // Addresses CC'd on the delivered email.
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  ccTo: string[];

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  // Delivery attempts made so far (the queue allows 5).
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt: Date | null;

  // Why the last attempt failed; cleared when an attempt succeeds.
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;
}
