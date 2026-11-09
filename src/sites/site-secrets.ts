import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // the recommended IV size for GCM
const FORMAT_VERSION = 'v1';

// A new site API key: 256 random bits, prefixed so it's recognisable in logs
// and config files.
export function generateApiKey(): string {
  return `sk_${randomBytes(32).toString('base64url')}`;
}

// API keys are long random values, so a plain SHA-256 is enough to make a
// stolen hash useless. (Slow hashes like argon2 are for human passwords,
// which are short enough to guess.) Being deterministic, the hash can be
// looked up directly with WHERE "apiKeyHash" = $1.
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

// Encrypts secrets that must be readable again later: the SMTP password and
// the copy of the API key a super-admin can reveal.
// Stored format: v1:<iv>:<auth tag>:<ciphertext>, each part base64url.
// GCM's auth tag makes decrypt() throw if the stored value was tampered with
// or was encrypted with a different key.
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string | undefined) {
    if (!base64Key) {
      throw new Error('SITE_SECRETS_KEY must be set');
    }
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'SITE_SECRETS_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)',
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');
    const [version, iv, tag, ciphertext] = parts;
    // The ciphertext part is legitimately empty for an empty secret, so
    // check the shape rather than truthiness.
    if (parts.length !== 4 || version !== FORMAT_VERSION || !iv || !tag) {
      throw new Error('Unrecognised encrypted value');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(), // throws if the tag doesn't match
    ]).toString('utf8');
  }
}
