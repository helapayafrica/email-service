import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SiteCcRecipients1794500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" ADD "ccRecipients" text array NOT NULL DEFAULT '{}'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sites" DROP COLUMN "ccRecipients"`);
  }
}
