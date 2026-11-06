import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import dataSource from '../database/data-source.js';
import { User } from '../users/entities/user.entity.js';
import { UserService } from '../users/user.service.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    site: { type: 'string' },
  },
});

if (!values.email || !values.name || !values.site) {
  console.error(
    'Usage: npm run user:create -- --email <email> --name "<full name>" --site <siteId>',
  );
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
    siteId: values.site,
    password,
  });
  console.log(
    `Created user ${user.email} (${user.id}) for site ${user.siteId}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
