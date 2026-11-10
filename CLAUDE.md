# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NVO Email Service: a NestJS 12 backend that receives contact-form submissions from several company websites (`POST /contact`), stores them in PostgreSQL, queues delivery via Bull/Redis, and sends HTML + plain-text email over SMTP. A JWT-authenticated dashboard API lets company users read their companies' requests with a delivery record (`/requests`) and manage each company's CC list (`/sites`), and super-admins manage companies (`/admin/sites`) and users (`/admin/users`). Node 24+, ESM (`"type": "module"`).

## Commands

```bash
npm run services:up      # Full local stack in Docker: API + Postgres + Redis + Mailpit (runs migrations on start)
npm run services:logs    # Follow API container logs
npm run services:down
npm run start:dev        # Run Nest on the host instead (needs Postgres/Redis reachable at localhost; .env DB_HOST/REDIS_HOST=localhost)

npm run build
npm run lint             # oxlint --type-aware on src/ and test/
npm run format           # prettier
npm test                 # vitest unit tests (*.spec.ts); Postgres/Redis/SMTP are mocked
npx vitest run src/mail/mail.processor.spec.ts   # single file
npx vitest run -t "marks the request failed"     # single test by name
npm run test:e2e         # *.e2e-spec.ts — boots the real AppModule, so needs live Postgres + Redis

npm run migration:show | migration:run | migration:revert
npm run migration:generate -- src/database/migrations/AddField
npm run migration:create -- src/database/migrations/AddField

npm run user:create -- --email a@b.com --name "A" --role super_admin   # or --site <id> (repeatable); prompts for the password. Only needed for the first super-admin; after that use POST /admin/users
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app npm run user:create:prod -- ...   # same, inside the local stack
```

`.env` needs `JWT_SECRET` (≥ 32 chars) and `SITE_SECRETS_KEY` (32 bytes, base64); the app and Compose refuse to start without them. A fresh database has no sites: create a super-admin, log in, `POST /admin/sites` (walkthrough in `README.md`).

Before merging/deploying the project docs ask for: `npm run build && npm run lint && npm test`.

Local URLs: API `http://localhost:3000`, Scalar API docs `/docs`, Mailpit inbox `http://localhost:8025`.

## Architecture

Request flow: `ContactController` → `ApiKeyGuard` → `ContactService` → Postgres row (`contact_requests`, status `queued`) → Bull job `send-contact-email` on queue `mail` → `MailProcessor` renders template and loads the site's mail settings → `MailService` (nodemailer) → status updated to `sent`/`failed`.

Dashboard flow: `POST /auth/login` (argon2id, 5/min throttle) returns a JWT with only `{ sub, email }`. `JwtAuthGuard` reloads the user from the database on every request (so `isActive`, `role` and `siteIds` changes apply immediately) and sets `request.user` (`AuthUser`, read with `@CurrentUser()`). `SuperAdminGuard` goes after it on `/admin/*`. Tenant scoping always goes through `SitesService.accessibleSiteIds(user)`: super-admins get every site (including inactive), company users get `users.siteIds`; a client-supplied `siteId` may only narrow that list, and anything outside it is a `404`, never `403`. `PUT /sites/:id/cc` (`src/company/`) follows the same rule. User admin (`/admin/users`) blocks a super-admin from deactivating or re-roling themselves; user changes apply on the next request because the guard reloads the user, but a password reset does not end open sessions (no token revocation yet).

Key points that span multiple files:

- **Sites** (companies) live in the `sites` table (`src/sites/`), managed by super-admins through `/admin/sites` (`src/admin/`); there is no env-based registry any more. The slug `id` is what websites send as `siteId` and is referenced by `contact_requests.siteId` and `users.siteIds`, so it never changes; sites are deactivated, not deleted. `ApiKeyGuard` looks the site up by the SHA-256 of `x-api-key` and requires it to match `body.siteId`. Secrets (API key copy, SMTP password) are encrypted with `SecretBox` using `SITE_SECRETS_KEY`; secret columns are `select: false`, and responses go through `SiteView`, which never contains them. `npm run site:import-env -- --from-file <env file>` is a one-off importer for old `SITE_<ID>_*` vars.
- **Async response**: `ContactService.handleContact` returns `202` immediately after the DB insert; enqueueing is fire-and-forget (`void ...catch`) and marks the row `failed` if Redis rejects it. The response confirms acceptance, not delivery.
- **Idempotency**: the `idempotency-key` header is required; an existing row with that key short-circuits and returns `duplicate: true` without queueing.
- **Retries**: jobs use `attempts: 5`, exponential backoff starting at 2s. `MailProcessor` calls `ContactService.markFailed` on each failed attempt (status `failed`, `attempts`, one-line `lastError`) and rethrows so Bull retries; a later success calls `markSent` (status `sent`, `deliveredTo`, `ccTo`, `sentAt`, error cleared). Delivery timestamps use the database's `now()`, like `createdAt`. `MAX_DELIVERY_ATTEMPTS` (entity file) drives both the job and the views' `willRetry`. Bull Redis is configured with `maxRetriesPerRequest: null` so HTTP requests don't fail on transient Redis disconnects.
- **Email template** lives inline in `mail.processor.ts`. All user-supplied fields must go through `escapeHtml` before interpolation into HTML; the spec asserts this. The submitter's email is used as `replyTo`. `MailProcessor` loads the recipient, CC list (`sites.ccRecipients`) and SMTP settings with `SitesService.getMailSettings(siteId)` at send time (never stored in the Bull job); a site with its own `smtpHost` sends through it from its `smtpFrom`, otherwise the global `SMTP_*` transport and `SMTP_FROM` are used.
- **API docs** (`src/docs/api-docs.ts`, called from `main.ts`): Scalar at `/docs` with a `customFetch` (`docsFetch`) that keeps the token from `POST /auth/login` in sessionStorage and adds `Authorization: Bearer` to later same-origin requests. The Scalar wrapper writes it into the page via `toString()`, so it must stay self-contained (the spec rebuilds it from source to enforce that). `DOCS_LOGIN_EMAIL`/`DOCS_LOGIN_PASSWORD` prefill the login example outside production only; they're passed only by `docker-compose.dev.yml`.
- **Global setup** in `main.ts`: Helmet with a CSP that whitelists `cdn.jsdelivr.net` (required for Scalar at `/docs`), global `AllExceptionsFilter` (uniform error body: `statusCode, timestamp, path, method, error, message`), `ValidationPipe({ whitelist, transform })`, CORS from `CORS_ORIGINS` (methods `GET`, `POST`, `PUT`, `PATCH`; allowed headers limited to `Content-Type`, `X-API-Key`, `Idempotency-Key`, `Authorization` — add new custom headers or methods here), `trust proxy` = 1 for throttling behind Nginx. `ThrottlerGuard` is global via `APP_GUARD`.

## Conventions / gotchas

- ESM with `nodenext` resolution: relative imports must include the `.js` extension (`'./contact.service.js'`).
- Schema changes go through TypeORM migrations only (`synchronize: false`). The migration CLI runs against compiled `dist/database/data-source.js`, so migration scripts build first. The Docker image runs pending migrations at container start (`start:prod:migrate`).
- `typescript/no-floating-promises` is an error in oxlint — intentionally detached promises must be prefixed with `void`.
- Unit tests construct services directly with hand-rolled mocks (`vi.fn()`, globals enabled) rather than via Nest's testing module.
- Mailpit exists only in `docker-compose.dev.yml`; production uses `docker-compose.prod.yml` with `.env.production` (`npm run prod:up`). Deployment details: `docs/VPS_DEPLOYMENT.md`, `docs/VPS_IP_DEPLOYMENT.md`. Upgrading an existing server to the dashboard-auth release (new secrets, migrations, site import): `docs/DEPLOY_DASHBOARD_AUTH.md`.

## In-progress work

Dashboard login (users, JWT auth, multi-company access, super-admin) is being built on `feature/dashboard-auth`. Plan, decisions, and what is done/pending: `docs/DASHBOARD_AUTH_PLAN.md`. Keep that file updated as steps finish.
