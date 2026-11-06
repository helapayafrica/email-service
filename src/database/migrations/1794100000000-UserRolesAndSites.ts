import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserRolesAndSites1794100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" varchar NOT NULL DEFAULT 'company_user'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "siteIds" text[] NOT NULL DEFAULT '{}'`,
    );
    // Carry each existing user's single company over to the new list.
    await queryRunner.query(`UPDATE "users" SET "siteIds" = ARRAY["siteId"]`);
    await queryRunner.query(`DROP INDEX "IDX_users_siteId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "siteId"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "siteId" varchar`);
    // Keeps only the first company; super-admins end up with ''.
    await queryRunner.query(
      `UPDATE "users" SET "siteId" = COALESCE("siteIds"[1], '')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "siteId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_siteId" ON "users" ("siteId")`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "siteIds"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
  }
}
