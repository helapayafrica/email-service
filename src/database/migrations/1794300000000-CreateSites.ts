import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Table } from 'typeorm';

export class CreateSites1794300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'sites',
        columns: [
          { name: 'id', type: 'varchar', length: '50', isPrimary: true },
          { name: 'name', type: 'varchar', length: '150' },
          { name: 'recipient', type: 'varchar', length: '254' },
          {
            name: 'apiKeyHash',
            type: 'varchar',
            length: '64',
            isUnique: true,
          },
          { name: 'apiKeyEncrypted', type: 'text' },
          {
            name: 'smtpHost',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'smtpPort', type: 'integer', isNullable: true },
          { name: 'smtpSecure', type: 'boolean', default: false },
          {
            name: 'smtpUser',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'smtpPassEncrypted', type: 'text', isNullable: true },
          {
            name: 'smtpFrom',
            type: 'varchar',
            length: '320',
            isNullable: true,
          },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
        checks: [
          {
            name: 'CHK_sites_id_slug',
            expression: `"id" ~ '^[a-z0-9][a-z0-9-]{1,49}$'`,
          },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sites');
  }
}
