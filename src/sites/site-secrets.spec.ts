import { createHash, randomBytes } from 'node:crypto';
import { SecretBox, generateApiKey, hashApiKey } from './site-secrets.js';

const KEY = randomBytes(32).toString('base64');

// Flips one bit in one base64url part of a stored value (1 = iv, 2 = tag,
// 3 = ciphertext).
function tamper(stored: string, part: 1 | 2 | 3): string {
  const parts = stored.split(':');
  const bytes = Buffer.from(parts[part], 'base64url');
  bytes[0] ^= 1;
  parts[part] = bytes.toString('base64url');
  return parts.join(':');
}

describe('generateApiKey', () => {
  it('returns sk_ plus 32 random bytes in base64url', () => {
    expect(generateApiKey()).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
  });

  it('returns a different key every time', () => {
    const keys = new Set(Array.from({ length: 100 }, generateApiKey));
    expect(keys.size).toBe(100);
  });
});

describe('hashApiKey', () => {
  it('is the hex SHA-256 of the key, so it can be looked up directly', () => {
    expect(hashApiKey('secret-key')).toBe(
      createHash('sha256').update('secret-key').digest('hex'),
    );
    expect(hashApiKey('secret-key')).toBe(hashApiKey('secret-key'));
    expect(hashApiKey('secret-key')).not.toBe(hashApiKey('secret-kez'));
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(KEY);

  it.each([
    ['an API key', generateApiKey()],
    ['an SMTP password with symbols', 'p@ss:w0rd/+=%'],
    ['unicode', 'pässwörd ✓ 密码'],
    ['an empty string', ''],
  ])('round-trips %s', (_case, secret) => {
    expect(box.decrypt(box.encrypt(secret))).toBe(secret);
  });

  it('stores v1:<iv>:<tag>:<ciphertext> without the plaintext', () => {
    const stored = box.encrypt('acme-smtp-pass');
    expect(stored).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(stored).not.toContain('acme-smtp-pass');
  });

  it('uses a fresh IV, so equal secrets encrypt differently', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it.each([
    ['the IV', 1],
    ['the auth tag', 2],
    ['the ciphertext', 3],
  ] as const)('rejects a value with a modified %s', (_case, part) => {
    const stored = box.encrypt('acme-smtp-pass');
    expect(() => box.decrypt(tamper(stored, part))).toThrow();
  });

  it('rejects a value encrypted with a different key', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => box.decrypt(other.encrypt('secret'))).toThrow();
  });

  it.each([
    ['plain text', 'not-encrypted'],
    ['an unknown version', 'v2:a:b:c'],
    ['missing parts', 'v1:abc'],
  ])('rejects %s', (_case, stored) => {
    expect(() => box.decrypt(stored)).toThrow('Unrecognised encrypted value');
  });

  it('requires a key', () => {
    expect(() => new SecretBox(undefined)).toThrow(
      'SITE_SECRETS_KEY must be set',
    );
    expect(() => new SecretBox('')).toThrow('SITE_SECRETS_KEY must be set');
  });

  it.each([
    ['too short', randomBytes(16).toString('base64')],
    ['too long', randomBytes(48).toString('base64')],
    ['not base64 of 32 bytes', 'short'],
  ])('rejects a key that is %s', (_case, key) => {
    expect(() => new SecretBox(key)).toThrow('must be 32 bytes');
  });
});
