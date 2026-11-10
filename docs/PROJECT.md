# Project guide

## Purpose

NVO Email Service is a central contact-form backend for multiple company
websites. A website sends a validated request to `POST /contact`; the service
saves it, queues a job, and returns immediately. A Bull worker then creates the
email, sends it over SMTP, and records whether delivery succeeded.

Company staff log in to a dashboard API to read their company's submissions.
Super-admins, the team running the service, manage the companies themselves.

## Concepts

- **Site:** one company website. Stored in the `sites` table with a permanent
  slug id (`deliva`), a display name, the recipient for its contact emails, an
  API key, and optionally its own SMTP server. Websites send the id as `siteId`.
- **Company user:** a dashboard login that can see the requests of the sites
  listed in its `siteIds`, and edit those sites' CC lists. One person can
  belong to several companies.
- **Super-admin:** a dashboard login that sees every site, creates, edits, and
  deactivates sites, manages their API keys and SMTP settings, and manages
  users.
- **CC list:** up to 10 addresses per site that are CC'd on every contact email
  for that site.
- **Delivery record:** stored on every contact request: where the email went,
  who was CC'd, when it was sent, how many attempts it took, and the last
  error.

## Request flow

```text
Company website
  -> POST /contact  (x-api-key, idempotency-key)
  -> validation, throttling, API-key check (site looked up by the key's hash)
  -> idempotency check
  -> PostgreSQL contact_requests row (status queued) -> 202 Accepted
  -> Redis/Bull mail job
  -> mail processor loads the site's recipient, CC list, and SMTP settings
  -> the site's own SMTP server, or the global SMTP_* server
  -> company recipient (+ CC); status sent or failed, with the delivery record
```

PostgreSQL is the durable record. Redis holds asynchronous jobs. SMTP delivers
the message. All three must be available for the full flow to work. SMTP
credentials are never put in the Redis job; the processor loads them from the
database when it sends, so a retry uses the site's current settings.

## Main directories

```text
src/
  admin/        super-admin endpoints for sites and users (/admin/*)
  auth/         login, JWT guard, super-admin guard, @CurrentUser()
  cli/          create-user and site:import-env command-line tools
  common/       API-key guard and global exception formatting
  company/      company settings any logged-in user can manage (/sites, CC)
  contact/      POST /contact, DTO, persistence, and queue submission
  database/     TypeORM data source and migrations
  mail/         Bull processor, SMTP client, and email template
  requests/     dashboard endpoints for reading contact requests
  sites/        site entity, SitesService, secret encryption
  users/        user entity, UserService, password hashing
  main.ts       security headers, CORS, validation, and Scalar setup
docs/           project and deployment documentation
```

## Environment variables

Copy `.env.example` to `.env` for local development. Do not commit `.env` or
real credentials.

| Variable                        | Purpose                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`                          | HTTP port; defaults to `3000`                                                            |
| `APP_URL`                       | Public base URL shown in startup logs                                                    |
| `DB_HOST`, `DB_PORT`            | PostgreSQL network address                                                               |
| `DB_USER`, `DB_PASS`, `DB_NAME` | PostgreSQL credentials and database                                                      |
| `REDIS_HOST`, `REDIS_PORT`      | Redis network address                                                                    |
| `SMTP_HOST`, `SMTP_PORT`        | Global SMTP server, used by sites without SMTP settings of their own                     |
| `SMTP_SECURE`                   | `true` for implicit TLS, normally port 465; `false` for STARTTLS/local                   |
| `SMTP_USER`, `SMTP_PASS`        | Global SMTP credentials; blank for local Mailpit                                         |
| `SMTP_FROM`                     | Sender for sites without their own From address                                          |
| `CORS_ORIGINS`                  | Comma-separated browser origins allowed to call the API (websites and the dashboard)     |
| `THROTTLE_TTL_MS`               | Rate-limit time window in milliseconds                                                   |
| `THROTTLE_LIMIT`                | Requests allowed per IP in the time window                                               |
| `JWT_SECRET`                    | **Required.** Signs login tokens; at least 32 characters (`openssl rand -base64 48`)     |
| `JWT_EXPIRES_IN_SECONDS`        | Login token lifetime; defaults to `3600`                                                 |
| `SITE_SECRETS_KEY`              | **Required.** 32 bytes, base64 (`openssl rand -base64 32`); encrypts site secrets        |

The app refuses to start if `JWT_SECRET` or `SITE_SECRETS_KEY` is missing or
the wrong size, and Compose refuses to start without them.

**Back up `SITE_SECRETS_KEY` with your other secrets.** It encrypts every
site's API key copy and SMTP password. A database backup without this key
can't recover them: you would have to re-enter each site's SMTP password and
issue new API keys to every website. Changing `JWT_SECRET` logs everyone out.

Companies are not configured through environment variables; see
[Managing sites](#managing-sites).

## Users

There is no public sign-up. Super-admins manage users through `/admin/users`
(see [API](#api)), with `curl` or in the browser at `/docs`:

- **Create** with `POST /admin/users`: `email`, `fullName`, `role`
  (`company_user` or `super_admin`), `siteIds`, and an initial `password` of at
  least 12 characters. Give the password to the person through a safe channel.
- **Change** name, role, companies, or active status with
  `PATCH /admin/users/:id`. Only the fields sent change. Changes apply on the
  user's next request; they don't need to log in again. Promoting to
  super-admin clears the companies; demoting needs `siteIds`.
- **Deactivate** with `"isActive": false`: the user is locked out on their next
  request.
- **Reset a password** with `POST /admin/users/:id/password`. Sessions that are
  already open stay valid until their token expires (`JWT_EXPIRES_IN_SECONDS`).
  To cut someone off at once, deactivate them, reset the password, then
  reactivate.
- A super-admin can't deactivate their own account or change their own role,
  so nobody can lock themselves out.

The first super-admin has to be created from the command line, since nobody
can log in yet. The password prompt requires at least 12 characters and is
shown as you type.

```bash
# In a running container (local: add -f docker-compose.dev.yml; production: see the VPS guides)
docker compose exec app npm run user:create:prod -- --email ops@deliva.com --name "Ops" --site deliva --site voltic
docker compose exec app npm run user:create:prod -- --email admin@example.com --name "Admin" --role super_admin

# Or on the host, with the database reachable at DB_HOST
npm run user:create -- --email ops@deliva.com --name "Ops" --site deliva
```

Each `--site` must be an existing site id. A company user needs at least one;
a super-admin takes none.

## Managing sites

Super-admins manage sites through `/admin/sites` (see [API](#api)), with `curl`
or in the browser at `/docs`.

- **Create** with `POST /admin/sites`: `id`, `name`, `recipient`, and
  optionally SMTP settings. The response includes the site's new API key. Put
  it in the website's configuration as `x-api-key`.
- **The id is permanent.** Websites send it, and stored requests and users
  refer to it. Use lowercase letters, digits, and dashes, 2 to 50 characters.
- **Own SMTP server** (optional): `smtpHost`, `smtpPort`, `smtpSecure`,
  `smtpUser`, `smtpPass`, and `smtpFrom`. With a host set, `smtpFrom` is
  required: a company's mail server usually rejects a sender on another domain.
  Configure SPF, DKIM, and DMARC for that domain. Without `smtpHost` the site
  uses the global `SMTP_*` settings; `smtpFrom` alone overrides only the sender.
- **Edit** with `PATCH /admin/sites/:id`. Only the fields sent change. Leaving
  out `smtpPass` keeps the stored password; `"smtpHost": null` removes the
  site's own SMTP settings entirely.
- **Deactivate** with `PATCH` and `"isActive": false`. Its key stops working,
  queued emails for it fail, and its requests stay visible in the dashboard.
  Sites are never deleted.
- **CC list:** any user who can see a site can replace its CC list with
  `PUT /sites/:id/cc` and `{ "cc": ["sales@deliva.com"] }` (`[]` clears it). Up
  to 10 addresses; the main recipient can't be on it. Every change is logged
  with the addresses added and removed and who made it, because whoever edits
  CC can copy the company's future submissions elsewhere.
- **Keys:** `GET /admin/sites/:id/api-key` reveals the current key.
  `POST /admin/sites/:id/rotate-key` issues a new one; **the old key stops
  working immediately**, so update the website straight away.

How secrets are stored: the API key as a SHA-256 hash, used to recognise
incoming requests, plus an AES-256-GCM encrypted copy, used for reveal. The
SMTP password is encrypted the same way. Admin responses never contain the key
hash or the SMTP password, only `smtp.hasPassword`. Create, update, rotate, and
reveal are logged with the acting user's id.

An API key embedded in browser JavaScript can be read by visitors. Treat these
keys as site identifiers and abuse-control inputs, not as credentials that can
safely grant access to sensitive data. Keep throttling enabled and consider
CAPTCHA or server-side submission for sites that attract abuse.

Sites from the old env-based setup (`SITE_<ID>_APIKEY`, `_RECIPIENT`, `_NAME`)
can be imported once, keeping their keys:
`npm run site:import-env -- --from-file .env`. See
[DEPLOY_DASHBOARD_AUTH.md](DEPLOY_DASHBOARD_AUTH.md) for production.

## API

The full, interactive reference is at `/docs`. Dashboard and admin endpoints
take `Authorization: Bearer <accessToken>`. In `/docs`, send `POST /auth/login`
once: the page keeps the token for that browser tab and adds it to later
requests to this API (never to other hosts), unless a token is set under
*Authentication*. It forgets the token when the API answers `401`. In
development, `DOCS_LOGIN_EMAIL` and `DOCS_LOGIN_PASSWORD` prefill the login
example; they are ignored when `NODE_ENV=production`. Both live in
`src/docs/api-docs.ts`.

| Endpoint                           | Who             | Purpose                                                   |
| ---------------------------------- | --------------- | --------------------------------------------------------- |
| `GET /`                            | anyone          | Health check                                              |
| `POST /contact`                    | websites        | Submit a contact form (`x-api-key`, `idempotency-key`)    |
| `POST /auth/login`                 | anyone          | Log in; returns `accessToken` and the user's sites        |
| `GET /auth/me`                     | logged in       | The current user and the sites they can see               |
| `GET /requests`                    | logged in       | Contact requests for the user's sites, newest first       |
| `GET /requests/:id`                | logged in       | One contact request                                       |
| `GET /sites`                       | logged in       | The user's companies, with recipient and CC list          |
| `PUT /sites/:id/cc`                | logged in       | Replace a company's CC list                               |
| `GET /admin/sites`                 | super-admin     | All sites, including inactive ones                        |
| `GET /admin/sites/:id`             | super-admin     | One site                                                  |
| `POST /admin/sites`                | super-admin     | Create a site; returns `{ site, apiKey }`                  |
| `PATCH /admin/sites/:id`           | super-admin     | Update or deactivate a site                               |
| `POST /admin/sites/:id/rotate-key` | super-admin     | Issue a new API key; the old one stops working            |
| `GET /admin/sites/:id/api-key`     | super-admin     | Reveal the current API key                                |
| `GET /admin/users`                 | super-admin     | All users, with their companies                           |
| `GET /admin/users/:id`             | super-admin     | One user                                                  |
| `POST /admin/users`                | super-admin     | Create a user                                             |
| `PATCH /admin/users/:id`           | super-admin     | Change name, role, companies, or active status            |
| `POST /admin/users/:id/password`   | super-admin     | Reset a user's password                                   |

### Health check

```http
GET /
```

Returns `NVO Email Service is running` when the HTTP process is responding.

### Submit a contact request

```http
POST /contact
Content-Type: application/json
x-api-key: <site API key>
idempotency-key: <unique submission ID>
```

Minimum body:

```json
{
  "siteId": "deliva",
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phoneNumber": "+254700000000",
  "message": "I would like to learn more about your services."
}
```

Optional body fields are `company` and `subject`. Generate one UUID when the
visitor starts a submission and reuse it only when retrying that same submission.
Generate a new idempotency key for a genuinely new message.

The endpoint returns `202 Accepted` as soon as the submission is stored. Redis
queueing and SMTP delivery continue asynchronously, so this response confirms
acceptance rather than final email delivery.

Typical accepted response:

```json
{
  "success": true,
  "message": "Thank you. Your message has been received and will be delivered shortly.",
  "requestId": "contact-request-uuid",
  "status": "accepted",
  "duplicate": false
}
```

The key must belong to the site named in `siteId`; a key for one site can't
post as another. An unknown, wrong, or deactivated site's key gets `401`.

### Log in

```http
POST /auth/login
Content-Type: application/json

{ "email": "ops@deliva.com", "password": "..." }
```

```json
{
  "accessToken": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "user": {
    "id": "6f1c...",
    "email": "ops@deliva.com",
    "fullName": "Ops",
    "role": "company_user",
    "sites": [{ "id": "deliva", "name": "Deliva Fasta" }]
  }
}
```

A wrong email, wrong password, and disabled account all return the same `401`.
Login allows 5 attempts per minute per IP. `GET /auth/me` returns the same
`user` object. The dashboard can use `sites` for its company switcher.

### List contact requests

```http
GET /requests?siteId=deliva&status=failed&q=jane&page=1&limit=20
Authorization: Bearer <accessToken>
```

All parameters are optional:

- `siteId`: one of the user's sites. Leave it out to list all of them. Any
  other site returns `404`, the same as a site that doesn't exist.
- `status`: `pending`, `queued`, `sent`, or `failed`.
- `q`: case-insensitive search in name, email, and subject.
- `page` (default 1) and `limit` (default 20, at most 100).

```json
{
  "items": [
    {
      "id": "b9d7895d-...",
      "siteId": "deliva",
      "siteName": "Deliva Fasta",
      "fullName": "Jane Doe",
      "email": "jane@example.com",
      "phoneNumber": "+254700000000",
      "company": "Acme Ltd",
      "subject": "Website enquiry",
      "message": "...",
      "status": "sent",
      "createdAt": "2026-11-09T10:30:00.000Z",
      "delivery": {
        "deliveredTo": "contact@deliva.com",
        "cc": ["sales@deliva.com"],
        "sentAt": "2026-11-09T10:30:01.000Z",
        "attempts": 1,
        "maxAttempts": 5,
        "willRetry": false,
        "lastAttemptAt": "2026-11-09T10:30:01.000Z",
        "lastError": null
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

`GET /requests/:id` returns one item, or `404` if it doesn't exist or belongs
to a site the user can't see.

`delivery` shows whether the email reached the company:

- `status: "sent"`: `deliveredTo` and `cc` are the addresses it actually went
  to, at `sentAt`. They stay as they were even if the site's recipient or CC
  list changes later.
- `status: "failed"` with `willRetry: true`: a delivery attempt failed and
  another will follow (up to `maxAttempts`). `lastError` says why, e.g.
  `EAUTH (535): Invalid login: ...`.
- `status: "failed"` with `willRetry: false`: delivery gave up, or the request
  couldn't be queued (`attempts: 0`).
- Requests from before delivery tracking have empty `delivery` fields.

### Errors

Errors use a consistent body:

```json
{
  "statusCode": 400,
  "timestamp": "2026-09-24T08:03:57.311Z",
  "path": "/contact",
  "method": "POST",
  "error": "Bad Request",
  "message": ["email must be an email"]
}
```

## Local email testing

Build and start the API, PostgreSQL, Redis, and Mailpit:

```bash
npm run services:up
```

The development Compose override automatically gives the application container
these local SMTP values:

```env
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Website Contact <no-reply@email-service.local>
```

The API container reaches dependencies by the Compose service names `postgres`,
`redis`, and `mailpit`; no database or Redis host ports are required. Open
`http://localhost:8025` to inspect captured messages. Mailpit never belongs in
the production environment. The [README](../README.md#try-it-out) walks through
creating a super-admin and a site and sending a test submission.

## Database migrations

Schema synchronization is disabled. Change the schema through migrations:

```bash
npm run migration:show
npm run migration:run
npm run migration:create -- src/database/migrations/AddField
npm run migration:generate -- src/database/migrations/AddField
npm run migration:revert
```

The production image automatically runs pending migrations immediately before
starting the API. Back up the database before deploying a destructive migration.

## Tests

Unit tests mock PostgreSQL, Redis, and SMTP, so supporting services are not needed:

```bash
npm test
npm run test:watch
npm run test:cov
```

Before merging or deploying, run:

```bash
npm run build
npm run lint
npm test
```

## Troubleshooting

### `Invalid API key or site`

- Confirm the site exists and is active (`GET /admin/sites`). A deactivated
  site's key gets this error; reactivate it with `PATCH /admin/sites/:id` and
  `{"isActive": true}`.
- Confirm `siteId` in the body is that site's id, and `x-api-key` is that
  site's current key: `GET /admin/sites/:id/api-key`. A rotated key stops
  working immediately.
- In Scalar, do not provide one value under Authentication and a different
  manual `x-api-key` header.

### Login returns `401` or `429`

`401` means a wrong email, wrong password, or a disabled user. All three look
the same on purpose. `429` means more than 5 attempts in a minute from one IP;
wait a minute.

### `MaxRetriesPerRequestError`

Bull cannot connect to Redis. Confirm Redis is running and verify
`REDIS_HOST`/`REDIS_PORT`. Use `localhost` when Nest runs on the host and `redis`
when Nest runs inside the same Compose network.

The Bull Redis connection is configured to reconnect without holding the HTTP
response. Redis must still be reachable before a job can actually enter the queue.
Once queued, failed SMTP delivery uses one initial attempt followed by retries
after approximately 2, 4, 8, and 16 seconds.

### Request is queued but no message arrives

- Look at the request's `delivery` in `GET /requests/:id`: `lastError` holds
  the SMTP error, and `deliveredTo` / `cc` show where a sent email went.
- Inspect the API/worker logs (`Contact email delivery failed ...` includes the
  SMTP error code).
- Check whether the site has its own SMTP settings (`GET /admin/sites/:id`). If
  it does, check those; if not, check the global `SMTP_*` settings.
- `EAUTH` means wrong SMTP credentials. Fix them with `PATCH`; emails still
  being retried use the new settings.
- `Site <id> does not exist or is inactive` means the site was deactivated
  after the form was submitted.
- Confirm the site's `recipient`.
- Inspect Mailpit at `http://localhost:8025` during local development.
- A CC'd address not receiving it: check the site's CC list with `GET /sites`,
  and the recipient's spam folder.

### Scalar is blocked by Content Security Policy

The `/docs` page loads Scalar's browser module from `https://cdn.jsdelivr.net`.
The application CSP permits that origin for `script-src`, `script-src-elem`, and
`connect-src`. Rebuild/restart the application after security-header changes. If
the response still contains a stricter policy, check Nginx for an additional
`Content-Security-Policy` header; multiple CSP headers are enforced together, so
a stricter proxy policy can still block the module.
