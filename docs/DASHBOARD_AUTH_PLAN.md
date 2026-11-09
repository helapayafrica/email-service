# Dashboard auth: plan and progress

Last updated: 2026-11-09. Branch: `feature/dashboard-auth`.

Use this file to pick the work up again after a break. Update the checklists
as steps are finished.

## Goal

Company staff log in to a shared dashboard and see the contact requests their
company's website received. The dashboard is multi-tenant:

- **One login page for everyone.** Each user sees only the companies
  (sites) they are assigned to.
- **A user can belong to several companies.** The dashboard lets them switch
  between companies or view all of them together.
- **A `super_admin` sees every company.** This is for the team running the
  service.

The backend (this repo) is built first. The frontend is a separate, later
piece of work.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Tenant | A site from `src/config/sites.config.ts` (`deliva`, `alumni`, `voltic`) | Sites already identify companies for `/contact` |
| Which companies a user can see | `users.siteIds text[]` column | Sites are defined in config, not in a database table, so a join table wouldn't give foreign-key integrity |
| Roles | `users.role`: `company_user` or `super_admin` | Super-admins have empty `siteIds` and can see all sites |
| Where tenant info comes from | Always loaded from the database by `JwtAuthGuard` | The client never chooses its own tenant, and role or site changes apply on the next request |
| Auth | `POST /auth/login` returns a JWT, sent as `Authorization: Bearer` | Uses `@nestjs/jwt` only, no Passport |
| JWT payload | `{ sub, email }` only | Keeps role and sites out of the token so they can't go stale |
| Password hashing | argon2id via `@node-rs/argon2` | Prebuilt binaries work on Alpine |
| Account creation | CLI only (`user:create`), no public sign-up | Otherwise anyone could register for any company |
| Requesting another tenant's data | Respond `404`, not `403` | Doesn't reveal that the record exists |
| Login rate limit | 5 attempts per minute per IP (`@Throttle` on login) | The global limit of 30 per minute is too loose for password guessing |

## Status

### Done

- [x] **Step 1: users table.** Entity `src/users/entities/user.entity.ts`, migration `1794000000000-CreateUsers`.
- [x] **Step 2: user service and CLI.** `UserService` (`src/users/user.service.ts`), argon2 helpers (`src/users/password.ts`), `src/cli/create-user.ts`, npm scripts `user:create` / `user:create:prod`.
- [x] **Step 3: login.** `src/auth/` module, `POST /auth/login`, `JWT_SECRET` / `JWT_EXPIRES_IN_SECONDS` config (the app refuses to start if the secret is missing or shorter than 32 characters), Compose passes them through.
- [x] **Step 4: guard.** `JwtAuthGuard` (reloads the user and rejects inactive users), `@CurrentUser()` decorator, `GET /auth/me`.
- [x] **Step 4b: multiple companies per user and roles.** Migration `1794100000000-UserRolesAndSites` replaces `siteId` with `role` + `siteIds`. `src/auth/site-access.ts` has `accessibleSiteIds()` / `canAccessSite()`. Login and `/auth/me` return `{ id, email, fullName, role, sites: [{ id, name }] }`.

Verified against the local Docker stack: user creation and its validation,
login, `/auth/me` for both roles, and `401` for a wrong password or a missing
token.

Commits: steps 1–3 are in `a9589d2`. Steps 4 and 4b are in the commit
"Add JWT guard, /auth/me, multi-company users and super-admin role". The
branch is not pushed yet.

### Pending

- [x] **Step 4, item 7: `src/main.ts`.** CORS allows `Authorization`; OpenAPI registers the `bearer` scheme.
- [x] **Step 5: requests API.** `src/requests/` (module, controller, service, `dto/list-requests.query.ts`).
  - `GET /requests?siteId&status&q&page&limit` returns `{ items, total, page, limit }`, newest first (ties broken by `id`). `siteId` can only narrow the user's accessible sites; any other value returns `404`. `q` is trimmed and searches name, email and subject with `ILIKE`, with `%` and `_` escaped so they match literally.
  - `GET /requests/:id` (`ParseUUIDPipe`) returns `404` for a missing row and for another tenant's row alike, because the site filter is part of the lookup.
  - Responses add `siteName` and leave out `idempotencyKey`.
  - Statuses now live in `CONTACT_REQUEST_STATUSES` / `ContactRequestStatus` in the entity.
  - Migration `1794200000000-ContactRequestsSiteIndex`: `("siteId", "createdAt")` ascending, not DESC as first planned. `@Index` can't express DESC, so a DESC index would make `migration:generate` try to change it, and Postgres scans the btree backwards for `ORDER BY ... DESC` anyway. The index is declared on the entity too.
  - Verified against a local stack: company-user vs super-admin scoping, filters, paging, 400/401/404 cases, CORS preflight, OpenAPI.
- [ ] **Step 5b: sites (companies) in the database, managed by super-admins.** Replaces `src/config/sites.config.ts` and the `SITE_*` env vars. Started 2026-11-09.
  - Decisions:
    - Site `id` stays a slug (`deliva`) and is the primary key, so `contact_requests.siteId` and `users.siteIds` keep working unchanged.
    - API key: SHA-256 **hash** for checking `x-api-key` (lookup by hash, no decryption) **plus** an AES-256-GCM **encrypted copy** so a super-admin can reveal it for the frontend. Generated server-side (`sk_` + 32 random bytes); rotating replaces both.
    - Each company has its own SMTP (host, port, secure, user, password, From). The password is encrypted (it must be usable to send, so it can't be hashed). If a site has no SMTP host, fall back to the global `SMTP_*` (keeps Mailpit working in dev).
    - One new env var `SITE_SECRETS_KEY` (32 bytes, base64; `openssl rand -base64 32`) encrypts all site secrets. Losing it makes stored secrets unreadable; back it up with `JWT_SECRET`.
    - SMTP credentials never go into the Bull job (Redis); `MailProcessor` loads the site by `siteId` when sending.
    - Sites are deactivated (`isActive = false`), not deleted, so `users.siteIds` and old requests never point at a missing site.
    - Admin responses never include the SMTP password or the API key hash; the key is returned only on create, rotate and an explicit reveal.
  - Parts:
    - [x] A. `src/sites/site-secrets.ts` (`generateApiKey`, `hashApiKey`, `SecretBox` encrypt/decrypt) and `SITE_SECRETS_KEY` in `.env*` and `docker-compose.yml`.
    - [x] B. `Site` entity (`src/sites/entities/site.entity.ts`) + migration `1794300000000-CreateSites`. `id` is a slug enforced by `CHK_sites_id_slug` (2–50 chars, `a-z0-9-`); `apiKeyHash` is unique; `apiKeyHash`, `apiKeyEncrypted` and `smtpPassEncrypted` are `select: false`. Registered in `data-source.ts`.
    - [x] C. `SitesService` (`findById`, `findActiveByApiKey`, `list`, `create`) + `SitesModule` (provides `SecretBox` from `SITE_SECRETS_KEY`; the app refuses to start without it), registered in `AppModule`. CLI `npm run site:import-env` / `site:import-env:prod` (`src/cli/import-sites-from-env.ts`) copies sites from `SITE_*` env vars with their current API keys; skips sites already in the table or missing env vars, never overwrites. `create` uses `insert`, not `save`, because `save` with a hand-picked primary key would overwrite an existing site.
      - Also fixed: `ContactRequest.fullName` now declares `length: 150` to match the database. Before, `migration:generate` would have dropped and re-added the column, losing every name. `migration:generate --check` now reports no changes.
    - [x] D. Everything reads sites from the database; only `import-sites-from-env.ts` still uses `sites.config.ts` (removed in F).
      - `ApiKeyGuard` looks the site up by the key's hash and requires it to match `body.siteId`; inactive sites get `401`.
      - `ContactService` rejects missing or inactive sites. The Bull job no longer carries the recipient: `MailProcessor` calls `SitesService.getMailSettings(siteId)` at send time (the only place the SMTP password is decrypted), so credentials never reach Redis and edited settings apply to retries.
      - `MailService.send(..., sender)` builds a transport from the site's SMTP, or uses the global `SMTP_*` transport when the site has none; `From` is the site's `smtpFrom` or `SMTP_FROM`. `SitesService.create` now requires `smtpFrom` whenever `smtpHost` is set.
      - `src/auth/site-access.ts` is gone: `SitesService.accessibleSiteIds(user)` (super-admins get every site, including inactive ones) and `namesById(ids)` replace it. `AuthService.profile` is now async. `UserService` validates `siteIds` against the table (`existingIds`), and `create-user` builds a `SitesService`.
      - Verified end to end with two Mailpit servers: a global-SMTP site and an own-SMTP site (with SMTP auth) each delivered to their own recipient from their own From address; a key for one site posting as another, a wrong key, an unknown site and a deactivated site all got `401`; `/auth/me` and `/requests` show names from the table; no secrets in logs.
    - [x] E. `SuperAdminGuard` (`src/auth/super-admin.guard.ts`, `403` for non-admins, used after `JwtAuthGuard`) and `src/admin/` (`AdminModule`, `AdminSitesController`, DTOs). Separate module because `AuthModule` already imports `SitesModule`.
      - `GET /admin/sites`, `GET /admin/sites/:id`, `POST /admin/sites` (returns `{ site, apiKey }`), `PATCH /admin/sites/:id` (only sent fields change; `isActive: false` deactivates; `id` can't change), `POST /admin/sites/:id/rotate-key`, `GET /admin/sites/:id/api-key`. Key responses send `Cache-Control: no-store`.
      - Responses (`SiteView`) never include the key, its hash or the SMTP password, only `smtp.hasPassword`. Admins can't choose a key (`apiKey` isn't in the DTO, so it's stripped); only the import can.
      - PATCH semantics: omitted keeps, `null`/`''` clears; `smtpHost: null` removes all of the site's own SMTP settings; omitting `smtpPass` keeps the stored one; clearing `smtpUser` also clears the password. The merged result is validated, and `smtpFrom` must contain an email address.
      - Audit log lines for create, update (field names only), rotate and reveal, with the acting user id. CORS now allows `PATCH`.
      - Behaviour to know: a queued email that is retried uses the site's settings at retry time, so an SMTP change applies to emails still being retried.
      - Verified live: create/list/get/reveal, PATCH keeps the password, adding/removing own SMTP routes mail to the right server, wrong SMTP password fails with `EAUTH` and the fix delivers on retry, rotation kills the old key, deactivate/reactivate, `403` for company users, `401` without a token, `404` for unknown ids, PATCH preflight, no secrets in logs.
    - [x] F. `src/config/sites.config.ts` is deleted and `SITE_*` is gone from `docker-compose.yml`, `.env.example` and `.env.production.example`; nothing in the app reads them. Done before the first production deploy, so the import stays possible: `import-sites-from-env.ts` now scans any `SITE_<ID>_APIKEY` (id = `<ID>` lowercased, `_` → `-`), keeps the old default names, and reads `--from-file <path>` (dotenv `parse`) or the process env. In production the one-off container mounts `.env.production` read-only (see `DEPLOY_DASHBOARD_AUTH.md` step 5). Named `--from-file`, not `--env-file`, because Node 24 checks `--env-file` itself even after the script name (exit 9 for a missing file). `dotenv` is now a direct dependency. `CLAUDE.md` updated.
    - [ ] G. Tests: secrets round-trip and tamper detection, guard by hash, per-site vs fallback SMTP, admin guard.
- [ ] **Step 6: configuration and docs.**
  - Production `.env.production`: generate a fresh `JWT_SECRET` with `openssl rand -base64 48`.
  - Add the dashboard's origin to `CORS_ORIGINS`.
  - Update `docs/VPS_DEPLOYMENT.md` and `docs/VPS_IP_DEPLOYMENT.md`: the JWT settings, plus creating the first super-admin on the server with `docker compose ... exec app npm run user:create:prod -- --email ... --name ... --role super_admin`.
  - Update `docs/PROJECT.md` (the API section and environment variable table), `README.md` and `CLAUDE.md`.
- [ ] **Step 7: tests.** Unit tests, following the hand-rolled `vi.fn()` style of the existing specs:
  - `UserService.create` validation: role, at least one site for a company user, unknown site, password length, duplicate email (`23505`).
  - `AuthService.login`: success, wrong password, unknown email, inactive user.
  - `JwtAuthGuard`: missing token, bad token, inactive or deleted user.
  - `SitesService`: `accessibleSiteIds`, `create` validation, `getMailSettings` decryption.
  - The requests service scoping: a company user can't read another site's requests, and a super-admin can read every site's requests.
- [ ] **Merge** `feature/dashboard-auth` into `main` and push. Deploy with [`DEPLOY_DASHBOARD_AUTH.md`](DEPLOY_DASHBOARD_AUTH.md): new secrets, then migrations **and** `site:import-env:prod` from the new image before switching containers (otherwise every website gets `401`).

### Later or optional

- [ ] User management CLI: add or remove sites for an existing user, deactivate a user, reset a password. For now this has to be done by editing the database with `psql`.
- [ ] Hide the password as it's typed in the `create-user` prompt (it currently echoes).
- [ ] Logout or token revocation. For now, tokens expire after `JWT_EXPIRES_IN_SECONDS`, and setting `isActive = false` locks a user out immediately.
- [ ] Frontend dashboard: login page, a company switcher based on `sites` from `/auth/me`, and a paginated requests table with a detail view.

## How to resume

```bash
git switch feature/dashboard-auth && git status
npm run build && npm run lint && npm test
npm run services:up          # rebuilds and runs pending migrations
npm run services:logs        # look for "Mapped {/auth/me, GET} route"
```

Shortcut for the commands below:

```bash
dc() { docker compose -f docker-compose.yml -f docker-compose.dev.yml "$@"; }
```

Postgres isn't published to the host, so run the CLI inside the container:

```bash
# Create users
dc exec app npm run user:create:prod -- --email ops@example.com --name "Ops" --site deliva --site voltic
dc exec app npm run user:create:prod -- --email admin@example.com --name "Admin" --role super_admin

# Inspect users
dc exec postgres psql -U emailservice -d emailservice -c 'select email, role, "siteIds", "isActive" from users'

# Log in and call a protected route (uses jq)
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ops@example.com","password":"<password>"}' | jq -r .accessToken)
curl -s localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```

## Gotchas found along the way

- Compose only passes the variables listed under `app.environment`. A new env
  var must be added to `docker-compose.yml` as well as the `.env` files.
- `.env` must exist locally, created with `cp .env.example .env`. Compose
  requires `JWT_SECRET` and refuses to start without it.
- Never put real secrets in `.env.example` or `.env.production.example`.
  These files are committed.
- A type used in a decorated method signature needs `import type` or a
  namespace import, because `isolatedModules` and `emitDecoratorMetadata` are
  both enabled.
- The login rate limit is 5 per minute. Repeated manual testing will start
  returning `429`; wait a minute.
