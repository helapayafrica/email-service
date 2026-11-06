import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table, TableIndex } from 'typeorm';


export class CreateUsers1794000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            isGenerated: true,
          },
          { name: 'email', type: 'varchar', length: '254', isUnique: true },
          { name: 'passwordHash', type: 'varchar', length: '255' },
          { name: 'siteId', type: 'varchar' },
          { name: 'fullName', type: 'varchar', length: '150' },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
    );


    await queryRunner.createIndex(
      'users',
      new TableIndex({ name: 'IDX_users_siteId', columnNames: ['siteId'] }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('users', 'IDX_users_siteId');
    await queryRunner.dropTable('users');
  }
}