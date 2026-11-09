// One-off move of sites from the old SITE_<ID>_* env vars into the sites
// table. Each site keeps its current API key, so websites already using it
// keep working.
//
//   SITE_DELIVA_APIKEY=...      required
//   SITE_DELIVA_RECIPIENT=...   required
//   SITE_DELIVA_NAME=...        optional
//
// becomes site id "deliva" (underscores in <ID> become dashes).
//
// The app no longer reads these vars and Compose no longer passes them, so
// point the script at the env file. (Not called --env-file: Node 24 checks
// that flag itself, even after the script name.)
//   node dist/cli/import-sites-from-env.js --from-file .env.production
// Without --from-file it reads the process environment.
//
// Safe to run more than once: sites already in the table are skipped, never
// overwritten. Imported sites have no SMTP settings of their own, so they
// keep using the global SMTP_* settings, exactly as before. Add per-site SMTP
// afterwards with PATCH /admin/sites/:id.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import dataSource from '../database/data-source.js';
import { Site } from '../sites/entities/site.entity.js';
import { SecretBox } from '../sites/site-secrets.js';
import { SitesService } from '../sites/sites.service.js';

// Display names the old hard-coded registry used when SITE_<ID>_NAME was
// unset, so imported sites keep the names they had.
const LEGACY_NAMES: Record<string, string> = {
  deliva: 'Deliva Fasta',
  alumni: 'Rongai Old Boys Alumni',
  voltic: 'Voltic Africa Limited',
};

const { values } = parseArgs({
  options: { 'from-file': { type: 'string' } },
});

const envFile = values['from-file'];
const source: Record<string, string | undefined> = envFile
  ? parse(readFileSync(envFile))
  : process.env;

// SITE_<ID>_APIKEY -> <ID>; one entry per site found.
const prefixes = Object.keys(source)
  .map((key) => /^SITE_([A-Z0-9_]+)_APIKEY$/.exec(key)?.[1])
  .filter((prefix): prefix is string => prefix !== undefined)
  .sort();

if (prefixes.length === 0) {
  console.error(
    `No SITE_<ID>_APIKEY variables found in ${envFile ?? 'the environment'}.`,
  );
  process.exit(1);
}

// SITE_SECRETS_KEY comes from the app's own environment, not from --from-file:
// it must be the key the running app uses.
const secrets = new SecretBox(process.env.SITE_SECRETS_KEY);

await dataSource.initialize();
let failed = false;
try {
  const sites = new SitesService(dataSource.getRepository(Site), secrets);

  for (const prefix of prefixes) {
    const id = prefix.toLowerCase().replaceAll('_', '-');
    const apiKey = source[`SITE_${prefix}_APIKEY`]?.trim();
    const recipient = source[`SITE_${prefix}_RECIPIENT`]?.trim();
    const name =
      source[`SITE_${prefix}_NAME`]?.trim() || LEGACY_NAMES[id] || id;

    if (!apiKey || !recipient) {
      console.warn(
        `skip   ${id}: SITE_${prefix}_APIKEY or SITE_${prefix}_RECIPIENT is empty`,
      );
      continue;
    }
    if (await sites.findById(id)) {
      console.log(`skip   ${id}: already in the database`);
      continue;
    }
    try {
      await sites.create({ id, name, recipient, apiKey });
      console.log(`import ${id}: ${name} -> ${recipient}`);
    } catch (error) {
      failed = true;
      console.error(
        `error  ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
} finally {
  await dataSource.destroy();
}
if (failed) process.exitCode = 1;
