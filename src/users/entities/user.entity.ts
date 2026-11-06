import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id:string;
  
  @Column('varchar', { length: 254 , unique: true })
  email: string;
  
  @Column('varchar', { length: 255, select: false })
  passwordHash: string
  
  
  @Index('IDX_user_siteId')
  @Column({type:'varchar'})
  siteId:string;
  
  
  @Column({ type: 'varchar', length: 150 })
  fullName: string;
  
  @Column({type:'boolean', default: true})
  isActive: boolean;
  
  
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
  
  
}