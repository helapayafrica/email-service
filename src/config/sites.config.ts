export interface SiteConfig {
  name: string;
  apiKey: string;
  recipient: string;
}

const siteDefinitions: Record<string, { prefix: string; defaultName: string }> =
  {
    deliva: { prefix: 'SITE_DELIVA', defaultName: 'Deliva Fasta' },
    alumni: { prefix: 'SITE_ALUMNI', defaultName: 'Rongai Old Boys Alumni' },
    voltic: { prefix: 'SITE_VOLTIC', defaultName: 'Voltic Africa Limited' },
  };

export function getSiteConfig(siteId: string): SiteConfig | undefined {
  const definition = siteDefinitions[siteId];
  if (!definition) return undefined;

  const apiKey = process.env[`${definition.prefix}_APIKEY`];
  const recipient = process.env[`${definition.prefix}_RECIPIENT`];
  if (!apiKey || !recipient) return undefined;

  return {
    name: process.env[`${definition.prefix}_NAME`] ?? definition.defaultName,
    apiKey,
    recipient,
  };
}
