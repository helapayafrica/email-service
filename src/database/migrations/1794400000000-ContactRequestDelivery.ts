import type { MigrationInterface, QueryRunner } from 'typeorm';

// Additive: existing rows get empty delivery fields and attempts = 0.
export class ContactRequestDelivery1794400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contact_requests" ADD "deliveredTo" varchar(254)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_requests" ADD "ccTo" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_requests" ADD "sentAt" timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_requests" ADD "attempts" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_requests" ADD "lastAttemptAt" timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_requests" ADD "lastError" varchar(500)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'lastError',
      'lastAttemptAt',
      'attempts',
      'sentAt',
      'ccTo',
      'deliveredTo',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "contact_requests" DROP COLUMN "${column}"`,
      );
    }
  }
}
