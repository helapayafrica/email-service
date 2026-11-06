import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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
  status: 'pending' | 'queued' | 'sent' | 'failed';

  @CreateDateColumn()
  createdAt: Date;
}
