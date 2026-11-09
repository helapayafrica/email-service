# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NVO Email Service: a NestJS 12 backend that receives contact-form submissions from several company websites (`POST /contact`), stores them in PostgreSQL, queues delivery via Bull/Redis, and sends HTML + plain-text email over SMTP. Node 24+, ESM (`"type": "module"`).

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
```

Before merging/deploying the project docs ask for: `npm run build && npm run lint && npm test`.

Local URLs: API `http://localhost:3000`, Scalar API docs `/docs`, Mailpit inbox `http://localhost:8025`.

## Architecture

Request flow: `ContactController` → `ApiKeyGuard` → `ContactService` → Postgres row (`contact_requests`, status `queued`) → Bull job `send-contact-email` on queue `mail` → `MailProcessor` renders template → `MailService` (nodemailer) → status updated to `sent`/`failed`.

Key points that span multiple files:

- **Sites** (companies) live in the `sites` table (`src/sites/`), managed by super-admins through `/admin/sites` (`src/admin/`); there is no env-based registry any more. The slug `id` is what websites send as `siteId` and is referenced by `contact_requests.siteId` and `users.siteIds`, so it never changes; sites are deactivated, not deleted. `ApiKeyGuard` looks the site up by the SHA-256 of `x-api-key` and requires it to match `body.siteId`. Secrets (API key copy, SMTP password) are encrypted with `SecretBox` using `SITE_SECRETS_KEY`; secret columns are `select: false`, and responses go through `SiteView`, which never contains them. `npm run site:import-env -- --from-file <env file>` is a one-off importer for old `SITE_<ID>_*` vars.
- **Async response**: `ContactService.handleContact` returns `202` immediately after the DB insert; enqueueing is fire-and-forget (`void ...catch`) and marks the row `failed` if Redis rejects it. The response confirms acceptance, not delivery.
- **Idempotency**: the `idempotency-key` header is required; an existing row with that key short-circuits and returns `duplicate: true` without queueing.
- **Retries**: jobs use `attempts: 5`, exponential backoff starting at 2s. `MailProcessor` sets status `failed` on each failed attempt and rethrows so Bull retries; a later success sets `sent`. Bull Redis is configured with `maxRetriesPerRequest: null` so HTTP requests don't fail on transient Redis disconnects.
- **Email template** lives inline in `mail.processor.ts`. All user-supplied fields must go through `escapeHtml` before interpolation into HTML; the spec asserts this. The submitter's email is used as `replyTo`. `MailProcessor` loads the recipient and SMTP settings with `SitesService.getMailSettings(siteId)` at send time (never stored in the Bull job); a site with its own `smtpHost` sends through it from its `smtpFrom`, otherwise the global `SMTP_*` transport and `SMTP_FROM` are used.
- **Global setup** in `main.ts`: Helmet with a CSP that whitelists `cdn.jsdelivr.net` (required for Scalar at `/docs`), global `AllExceptionsFilter` (uniform error body: `statusCode, timestamp, path, method, error, message`), `ValidationPipe({ whitelist, transform })`, CORS from `CORS_ORIGINS` (methods `GET`, `POST`, `PATCH`; allowed headers limited to `Content-Type`, `X-API-Key`, `Idempotency-Key`, `Authorization` — add new custom headers or methods here), `trust proxy` = 1 for throttling behind Nginx. `ThrottlerGuard` is global via `APP_GUARD`.

## Conventions / gotchas

- ESM with `nodenext` resolution: relative imports must include the `.js` extension (`'./contact.service.js'`).
- Schema changes go through TypeORM migrations only (`synchronize: false`). The migration CLI runs against compiled `dist/database/data-source.js`, so migration scripts build first. The Docker image runs pending migrations at container start (`start:prod:migrate`).
- `typescript/no-floating-promises` is an error in oxlint — intentionally detached promises must be prefixed with `void`.
- Unit tests construct services directly with hand-rolled mocks (`vi.fn()`, globals enabled) rather than via Nest's testing module.
- Mailpit exists only in `docker-compose.dev.yml`; production uses `docker-compose.prod.yml` with `.env.production` (`npm run prod:up`). Deployment details: `docs/VPS_DEPLOYMENT.md`, `docs/VPS_IP_DEPLOYMENT.md`. Upgrading an existing server to the dashboard-auth release (new secrets, migrations, site import): `docs/DEPLOY_DASHBOARD_AUTH.md`.

## In-progress work

Dashboard login (users, JWT auth, multi-company access, super-admin) is being built on `feature/dashboard-auth`. Plan, decisions, and what is done/pending: `docs/DASHBOARD_AUTH_PLAN.md`. Keep that file updated as steps finish.
