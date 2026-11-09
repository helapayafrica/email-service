import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const USER_ROLES = ['company_user', 'super_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 254, unique: true })
  email: string;

  @Column('varchar', { length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', default: 'company_user' })
  role: UserRole;

  // Companies this user can see (ids from the sites table).
  // Ignored for super_admin, who can see every company.
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  siteIds: string[];

  @Column({ type: 'varchar', length: 150 })
  fullName: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
