import { docsFetch, docsLoginExample } from './api-docs.js';

const ORIGIN = 'http://localhost:3000';

// Rebuild docsFetch from its source text, the way the Scalar page gets it, with
// the browser globals it uses passed in. This also proves the function is
// self-contained: any reference to module scope would throw here.
function loadInBrowser(responder: (request: Request) => Response) {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const sent: Request[] = [];
  const fetch = (request: Request) => {
    sent.push(request);
    return Promise.resolve(responder(request));
  };
  // Deliberate: this is how the page receives the function, as source text.
  // oxlint-disable-next-line typescript/no-implied-eval
  const create = new Function(
    'fetch',
    'sessionStorage',
    'location',
    `return (${docsFetch.toString()})`,
  ) as (...globals: unknown[]) => typeof docsFetch;
  return {
    fetch: create(fetch, sessionStorage, {
      href: `${ORIGIN}/docs`,
      origin: ORIGIN,
    }),
    sent,
    store,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const login = (docs: ReturnType<typeof loadInBrowser>) =>
  docs.fetch(`${ORIGIN}/auth/login`, {
    method: 'POST',
    body: '{"email":"a@b.test","password":"x"}',
  });

describe('docsFetch (the /docs request helper)', () => {
  it('remembers the token from a successful login and adds it to later requests', async () => {
    const docs = loadInBrowser((request) =>
      request.url.endsWith('/auth/login')
        ? json({ accessToken: 'jwt-123' })
        : json({ ok: true }),
    );

    const response = await login(docs);
    // The caller (Scalar) can still read the login response.
    await expect(response.json()).resolves.toEqual({ accessToken: 'jwt-123' });

    await docs.fetch(`${ORIGIN}/requests`);
    expect(docs.sent[1].headers.get('authorization')).toBe('Bearer jwt-123');
  });

  it('adds nothing before anyone has logged in', async () => {
    const docs = loadInBrowser(() => json({}));

    await docs.fetch(`${ORIGIN}/requests`);

    expect(docs.sent[0].headers.has('authorization')).toBe(false);
  });

  it('never overrides a token set in the Authentication panel', async () => {
    const docs = loadInBrowser(() => json({ accessToken: 'jwt-123' }));
    await login(docs);

    await docs.fetch(`${ORIGIN}/requests`, {
      headers: { Authorization: 'Bearer typed-by-hand' },
    });

    expect(docs.sent[1].headers.get('authorization')).toBe(
      'Bearer typed-by-hand',
    );
  });

  it('never sends the token to another origin', async () => {
    const docs = loadInBrowser(() => json({ accessToken: 'jwt-123' }));
    await login(docs);

    await docs.fetch('https://evil.example/collect');

    expect(docs.sent[1].headers.has('authorization')).toBe(false);
  });

  it('keeps the old token when a login fails', async () => {
    const docs = loadInBrowser(() =>
      docs.sent.length === 1
        ? json({ accessToken: 'jwt-123' })
        : json({ message: 'Invalid email or password' }, 401),
    );
    await login(docs);

    await login(docs);

    expect(docs.store.get('nvo-docs-access-token')).toBe('jwt-123');
    // And the login request itself never carries the old token.
    expect(docs.sent[1].headers.has('authorization')).toBe(false);
  });

  it('forgets the token when the API rejects it', async () => {
    const docs = loadInBrowser((request) =>
      request.url.endsWith('/auth/login')
        ? json({ accessToken: 'jwt-123' })
        : json({ message: 'Invalid or expired token' }, 401),
    );
    await login(docs);

    await docs.fetch(`${ORIGIN}/requests`);
    await docs.fetch(`${ORIGIN}/requests`);

    expect(docs.store.has('nvo-docs-access-token')).toBe(false);
    expect(docs.sent[2].headers.has('authorization')).toBe(false);
  });
});

describe('docsLoginExample', () => {
  const env = {
    NODE_ENV: 'development',
    DOCS_LOGIN_EMAIL: ' admin@example.com ',
    DOCS_LOGIN_PASSWORD: 'local-admin-password',
  };

  it('uses the configured credentials in development', () => {
    expect(docsLoginExample(env)).toEqual({
      email: 'admin@example.com',
      password: 'local-admin-password',
    });
  });

  it('never shows credentials in production, even if they are set', () => {
    expect(docsLoginExample({ ...env, NODE_ENV: 'production' })).toBeNull();
  });

  it.each(['DOCS_LOGIN_EMAIL', 'DOCS_LOGIN_PASSWORD'])(
    'shows nothing when %s is missing',
    (name) => {
      expect(docsLoginExample({ ...env, [name]: '' })).toBeNull();
    },
  );
});
