import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import dataSource from '../database/data-source.js';
import {
  User,
  USER_ROLES,
  type UserRole,
} from '../users/entities/user.entity.js';
import { UserService } from '../users/user.service.js';

const usage = `Usage:
  npm run user:create -- --email <email> --name "<full name>" --site <siteId> [--site <siteId> ...]
  npm run user:create -- --email <email> --name "<full name>" --role super_admin`;

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    site: { type: 'string', multiple: true },
    role: { type: 'string', default: 'company_user' },
  },
});

const role = values.role as UserRole;
if (!values.email || !values.name || !USER_ROLES.includes(role)) {
  console.error(usage);
  process.exit(1);
}

// Prompt instead of a --password flag so the password stays out of shell history.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Password (min 12 characters): ');
rl.close();

await dataSource.initialize();
try {
  const users = new UserService(dataSource.getRepository(User));
  const user = await users.create({
    email: values.email,
    fullName: values.name,
    password,
    role,
    siteIds: values.site ?? [],
  });
  const scope =
    user.role === 'super_admin' ? 'all sites' : user.siteIds.join(', ');
  console.log(`Created ${user.role} ${user.email} (${user.id}) for ${scope}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
