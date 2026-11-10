// Sets a new password for an existing user. Meant for when nobody can log in
// (for example the only super-admin forgot their password); otherwise a
// super-admin can use POST /admin/users/:id/password.
//
//   npm run user:reset-password -- --email admin@example.com [--activate]
//
// Prompts for the password twice (hidden), so it stays out of shell history.
// --activate also re-enables a deactivated account.
//
// Sessions that are already open stay valid until their token expires; to
// lock someone out at once, deactivate them instead.
import { parseArgs } from 'node:util';
import dataSource from '../database/data-source.js';
import { User } from '../users/entities/user.entity.js';
import {
  MIN_PASSWORD_LENGTH,
  UserService,
  normalizeEmail,
} from '../users/user.service.js';
import { Site } from '../sites/entities/site.entity.js';
import { SecretBox } from '../sites/site-secrets.js';
import { SitesService } from '../sites/sites.service.js';
import { promptNewPassword } from './password-prompt.js';

const usage = `Usage:
  npm run user:reset-password -- --email <email> [--activate]`;

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    activate: { type: 'boolean', default: false },
  },
});

if (!values.email) {
  console.error(usage);
  process.exit(1);
}

await dataSource.initialize();
try {
  const users = new UserService(
    dataSource.getRepository(User),
    new SitesService(
      dataSource.getRepository(Site),
      new SecretBox(process.env.SITE_SECRETS_KEY),
    ),
  );

  const email = normalizeEmail(values.email);
  const user = await dataSource.getRepository(User).findOne({
    where: { email },
  });
  if (!user) {
    throw new Error(`No user with email ${email}`);
  }

  const password = await promptNewPassword(MIN_PASSWORD_LENGTH);
  await users.setPassword(user.id, password);

  let state = user.isActive ? 'active' : 'still deactivated (use --activate)';
  if (values.activate && !user.isActive) {
    await dataSource.getRepository(User).update(user.id, { isActive: true });
    state = 'reactivated';
  }
  console.log(
    `Password reset for ${user.role} ${user.email}; account ${state}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
