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
] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

@Index('IDX_contact_requests_siteId_createdAt', ['siteId', 'createdAt'])
@Entity('contact_requests')
export class ContactRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  idempotencyKey: string;

  @Column()
  siteId: string;

  @Column()
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
}
