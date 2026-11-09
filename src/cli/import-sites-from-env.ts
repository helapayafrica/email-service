// One-off move of the sites defined in src/config/sites.config.ts and the
// SITE_<NAME>_* env vars into the sites table. Each site keeps its current
// API key, so websites already using it keep working.
//
// Safe to run more than once: sites already in the table are skipped, never
// overwritten. Imported sites have no SMTP settings of their own, so they
// keep using the global SMTP_* settings, exactly as before.
import dataSource from '../database/data-source.js';
import { getSiteConfig, listSiteIds } from '../config/sites.config.js';
import { Site } from '../sites/entities/site.entity.js';
import { SecretBox } from '../sites/site-secrets.js';
import { SitesService } from '../sites/sites.service.js';

const secrets = new SecretBox(process.env.SITE_SECRETS_KEY);

await dataSource.initialize();
let failed = false;
try {
  const sites = new SitesService(dataSource.getRepository(Site), secrets);

  for (const id of listSiteIds()) {
    const config = getSiteConfig(id);
    if (!config) {
      console.warn(
        `skip   ${id}: its _APIKEY or _RECIPIENT env var is not set`,
      );
      continue;
    }
    if (await sites.findById(id)) {
      console.log(`skip   ${id}: already in the database`);
      continue;
    }
    try {
      await sites.create({
        id,
        name: config.name,
        recipient: config.recipient,
        apiKey: config.apiKey,
      });
      console.log(`import ${id}: ${config.name} -> ${config.recipient}`);
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
