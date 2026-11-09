import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContactRequestsSiteIndex1794200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_requests_siteId_createdAt" ON "contact_requests" ("siteId", "createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_contact_requests_siteId_createdAt"`,
    );
  }
}
