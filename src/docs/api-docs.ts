import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

/**
 * Runs in the browser as Scalar's `customFetch`: every "Try it" request goes
 * through it. It makes logging in at /docs enough to use the protected
 * endpoints, without copying the token into the Authentication panel:
 *
 * - After a successful POST /auth/login it keeps the accessToken for this
 *   browser tab (sessionStorage).
 * - It adds `Authorization: Bearer <token>` to later requests that don't
 *   already have an Authorization header, so a token typed into Scalar's
 *   Authentication panel always wins.
 * - Only for requests to the page's own origin, so the token never goes to
 *   another host.
 * - A 401 on a request it added the token to forgets the token (expired or
 *   the user was deactivated); log in again.
 *
 * The Scalar wrapper writes this function into the page with
 * Function.prototype.toString(), so it must stay self-contained: no imports,
 * no references to anything outside its own body.
 */
export const docsFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const storageKey = 'nvo-docs-access-token';
  const read = (): string | null => {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  const write = (token: string | null): void => {
    try {
      if (token) sessionStorage.setItem(storageKey, token);
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Storage blocked (private mode): fall back to the Authentication panel.
    }
  };

  const request = new Request(input, init);
  const url = new URL(request.url, location.href);
  const sameOrigin = url.origin === location.origin;
  const isLogin =
    sameOrigin &&
    request.method === 'POST' &&
    url.pathname.endsWith('/auth/login');

  // Not on the login request itself: a failed login must not look like a
  // rejected token and wipe the session that is still valid.
  const token = sameOrigin && !isLogin ? read() : null;
  const addedToken = Boolean(token) && !request.headers.has('authorization');
  if (addedToken) {
    request.headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(request);

  if (isLogin && response.ok) {
    try {
      const body = (await response.clone().json()) as { accessToken?: unknown };
      if (typeof body.accessToken === 'string') write(body.accessToken);
    } catch {
      // Not JSON: leave the stored token as it was.
    }
  } else if (addedToken && response.status === 401) {
    write(null);
  }

  return response;
};

// Example values for POST /auth/login in /docs. Development only: in
// production /docs is public, so a real password must never appear there.
export function docsLoginExample(
  env: NodeJS.ProcessEnv,
): { email: string; password: string } | null {
  if (env.NODE_ENV === 'production') return null;
  const email = env.DOCS_LOGIN_EMAIL?.trim();
  const password = env.DOCS_LOGIN_PASSWORD;
  return email && password ? { email, password } : null;
}

type OpenApiDocument = ReturnType<typeof SwaggerModule.createDocument>;

function applyLoginExample(
  document: OpenApiDocument,
  example: { email: string; password: string },
): void {
  const schema = document.components?.schemas?.LoginDto;
  if (!schema || !('properties' in schema) || !schema.properties) return;
  for (const [field, value] of Object.entries(example)) {
    const property = schema.properties[field];
    if (property && !('$ref' in property)) property.example = value;
  }
}

export function setupApiDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('NVO Email Service')
    .setDescription(
      'Multi-site contact form delivery API. To try the dashboard endpoints, send POST /auth/login first: the token is then added to your requests automatically (this browser tab only).',
    )
    .setVersion('1.0.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-api-key' },
      'site-api-key',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const loginExample = docsLoginExample(process.env);
  if (loginExample) applyLoginExample(document, loginExample);

  app.use(
    '/docs',
    apiReference({
      content: document,
      theme: 'purple',
      customFetch: docsFetch,
    }),
  );
}
