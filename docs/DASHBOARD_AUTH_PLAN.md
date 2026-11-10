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
- [x] **Step 5b: sites (companies) in the database, managed by super-admins.** Replaces `src/config/sites.config.ts` and the `SITE_*` env vars. Started 2026-11-09.
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
    - [x] G. Tests (27 → 110): `site-secrets.spec.ts` (key format, hash, round-trip incl. unicode/empty, fresh IV, tampered IV/tag/ciphertext, wrong key, bad keys), `sites.service.spec.ts` (create validation and conflicts, hash + encrypted storage, no secrets in views, update merge rules, rotate/reveal, mail settings and port defaults, access scoping), `super-admin.guard.spec.ts`, `mail.service.spec.ts` (global vs per-site transport and From), `admin-sites.controller.spec.ts` (audit log names fields but never values or keys; DTO null rules). Guard-by-hash and processor-side SMTP were covered in D. Mutation-checked: breaking the guard's site match, leaking the key hash in views, dropping the SMTP password on update, or ignoring per-site SMTP each fails a test.
      - Found and fixed: `SecretBox.decrypt` rejected the encryption of an empty string (empty ciphertext part looked malformed). Not reachable from the app today, but the box now round-trips every input.
- [x] **Step 6: configuration and docs.**
  - `README.md`: features, local setup now generates `JWT_SECRET` / `SITE_SECRETS_KEY` (blank values stop Compose), and a "Try it out" walkthrough: create super-admin, log in, `POST /admin/sites`, submit with the returned key, read `/requests`. Run end to end against the local stack.
  - `docs/PROJECT.md` rewritten: concepts, flow, directories, env table (new secrets, no `SITE_*`), users, managing sites, full endpoint table with login/requests examples, troubleshooting for the new errors.
  - `VPS_DEPLOYMENT.md` and `VPS_IP_DEPLOYMENT.md`: env blocks use the new secrets instead of `SITE_*`, a "Create the first super-admin and your sites" step, backup warning about `SITE_SECRETS_KEY`, a pointer to `DEPLOY_DASHBOARD_AUTH.md` for upgrading env-based servers, checklist items.
  - `CLAUDE.md`: overview, user commands and required env, dashboard flow and tenant-scoping rule.
  - Found and fixed: `AppController` (the `GET /` health check every guide uses) was never registered in `AppModule`, on `main` too, so `GET /` returned `404`. Now registered.
  - Server-side, at deploy time (covered by `DEPLOY_DASHBOARD_AUTH.md`): fresh production `JWT_SECRET` and `SITE_SECRETS_KEY`. Add the dashboard's origin to `CORS_ORIGINS` once the frontend exists.
- [x] **Step 7: tests** (110 → 154), hand-rolled mocks as in the existing specs:
  - `users/user.service.spec.ts`: normalisation, argon2id hash that verifies, duplicate sites dropped, super-admin stored without sites, re-read user has no hash, every validation error, duplicate email `23505` → `409`.
  - `auth/auth.service.spec.ts`: success payload and profile (unknown site falls back to its id), token holds only `{ sub, email }`, no hash in the response; wrong password, inactive user and unknown email all give the same `401` and no token; an unknown email still runs one password verification (timing).
  - `auth/jwt-auth.guard.spec.ts` (real `JwtService`): valid token loads the user from the database, role/sites come from the database not the token, lowercase scheme; missing header, other scheme, malformed, wrong-secret and expired tokens; deleted and inactive users.
  - `requests/requests.service.spec.ts`: company user scoped to their sites, super-admin to all, `siteId` narrows but anything outside is `404` with no query, empty-site users, status filter, `%`/`_` escaping, paging and ordering, site names, no `idempotencyKey`; `findOne` filters by `siteId IN (...)`, other tenant's row is `404`.
  - Mutation-checked: trusting the client's `siteId`, dropping the tenant filter in `findOne`, letting inactive users through the guard or login, taking the role from the token, removing the timing protection, and storing sites for super-admins each fails a test.
- [x] **Step 8: requirements review (2026-11-10).** Checked against what the system must do: super-admin manages company keys and SMTP ✅; users and which companies they see ⚠️ CLI only, nothing can change a user afterwards; logged-in users see their companies' requests ✅; whether each email reached its company ⚠️ only `status`, no record of where it went or why it failed; CC ❌ new.
  - Decisions: **CC = a standing list per company**; every new contact email for the company is CC'd to it. **Any logged-in user can edit CC for the companies they can see** (super-admins for all); they still can't touch SMTP or keys.
  - [x] 8a. Delivery tracking. Migration adds to `contact_requests`: `deliveredTo`, `ccTo text[]`, `sentAt`, `attempts`, `lastError` (truncated, single line). `MailProcessor` records them on success and on each failed attempt. `/requests` and `/requests/:id` return them, so the dashboard shows where each email went, when, and why it failed.
    - Done: migration `1794400000000-ContactRequestDelivery` adds `deliveredTo`, `ccTo` (empty until 8b), `sentAt`, `attempts`, `lastAttemptAt`, `lastError`. `ContactService.markSent` / `markFailed` replace `updateStatus`; times use the database's `now()` like `createdAt`, so they agree whatever the app server's time zone. `lastError` looks like `EAUTH (535): Invalid login: ...`, one line, max 500 chars; a queueing failure records `Could not be queued for delivery` with `attempts: 0`. Views return a `delivery` object: `deliveredTo`, `cc`, `sentAt`, `attempts`, `maxAttempts`, `willRetry` (failed but attempts left), `lastAttemptAt`, `lastError`. `MAX_DELIVERY_ATTEMPTS` (5) lives in the entity file and drives the Bull job too.
    - Verified live: a sent email records where it went; a wrong SMTP password shows `failed`, `willRetry: true` and the SMTP error; after fixing the password the retry recorded `sent` on attempt 3 with the error cleared; `sentAt` and `createdAt` agree with the app running in EAT.
    - Company users can see `lastError`, which may name an SMTP host (e.g. `ECONNREFUSED 10.0.0.5:587`). Acceptable for now; revisit if the global SMTP host should stay hidden from tenants.
  - [x] 8b. Company CC list. Migration adds `sites.ccRecipients text[]` (max 10, valid emails, lowercased, de-duplicated, not the main recipient). `MailProcessor` sends with `cc` and records it in `ccTo`. `GET /sites` (the user's companies with name, recipient and CC) and `PUT /sites/:id/cc` for logged-in users, scoped by `accessibleSiteIds` (`404` outside). Super-admin `SiteView` shows CC too. Audit-log every change with the user id. Note: whoever can edit CC can copy a company's future submissions to any address; that's inherent in the feature, hence the audit log.
    - Done: migration `1794500000000-SiteCcRecipients`. `src/company/` (`CompanyModule`, `CompanySitesController`, `UpdateCcDto`; own module because `AuthModule` imports `SitesModule`): `GET /sites` returns `CompanySiteView` (id, name, recipient, cc, isActive; no SMTP or keys), `PUT /sites/:id/cc` replaces the list (`[]` clears). `SitesService.normalizeCc` trims, lowercases, de-duplicates, max 10, valid emails, rejects the main recipient. Admin `SiteView` and `SiteMailSettings` include `cc`; `MailProcessor` sends with it and records it in `ccTo`. `MailService.send` now takes a `MailMessage` object. CORS allows `PUT`. The audit log names the added and removed addresses and the user id.
    - Verified live: a company user listed and set CC for their company; `404` for another company, `400` for the main recipient or a bad body, `403` on `/admin/sites`; the delivered email had the `Cc:` header and the request recorded `cc`; clearing works; both changes in the audit log.
  - [x] 8c. User management API for super-admins, replacing hand edits in `psql`: `GET /admin/users`, `POST /admin/users` (email, name, role, sites, initial password, same rules as `user:create`), `PATCH /admin/users/:id` (name, role, sites, `isActive`), `POST /admin/users/:id/password` (reset). A super-admin can't deactivate or demote themselves (no lock-out). Responses never include `passwordHash`. Changes apply on the user's next request, because `JwtAuthGuard` reloads the user.
    - Done: `AdminUsersController` in `AdminModule` (`src/admin/admin-users.controller.ts`, DTOs `create-user`, `update-user`, `set-password`). `UserService` gained `list`, `getOrThrow`, `update(actor, id, input)` and `setPassword`; `create` and `update` share the validation (`validFullName` now also caps at 150, which `create` lacked: a long name used to be a 500). `update` validates the merged state: promoting clears sites, demoting requires sites. `:id` uses `ParseUUIDPipe`. Views (`UserView`) carry site names and never the hash. Audit log for create, update (role, sites, isActive) and password reset, never the password.
    - Verified live: created a user over the API (email lowercased), `409` duplicate, `400` unknown site; adding a company showed up on the user's next request with the same token; deactivating gave `401` on the very next request and at login; after a reset the old password failed and the new one worked; promote cleared sites, demote without sites `400`; self-deactivate and self-role-change `400`; company user `403`; unknown id `404`, bad id `400`; no passwords in the log.
    - Known limit: a password reset doesn't end sessions already open (tokens last `JWT_EXPIRES_IN_SECONDS`). To cut someone off at once: deactivate, reset, reactivate. Real revocation stays under "Later".
  - [x] 8d. Tests for 8a–8c, and docs (`PROJECT.md`, `README.md`, `DEPLOY_DASHBOARD_AUTH.md` migration list, `CLAUDE.md`).
    - Tests were written with each part (8a–8c, 162 → 211). Docs: `PROJECT.md` (concepts, flow, directories, users over the API, CC in managing sites, endpoint table, `delivery` example and how to read it, troubleshooting), `README.md` (features; walkthrough steps 5–7: delivery record, add a company user, set CC), `DEPLOY_DASHBOARD_AUTH.md` (migrations, API row, company users over the API, delivery check, known limits), `CLAUDE.md` (overview, delivery bookkeeping, CC in mail settings, CORS `PUT`, user-admin rules).
- [x] **Merge** `feature/dashboard-auth` into `main` and push: done 2026-11-10 (fast-forward to `7ab5336`). **Deploy still pending**: follow [`DEPLOY_DASHBOARD_AUTH.md`](DEPLOY_DASHBOARD_AUTH.md) (new secrets, then migrations **and** `site:import-env:prod` from the new image before switching containers, otherwise every website gets `401`).

### Later or optional

- [ ] ~~User management CLI~~: replaced by the `/admin/users` API in step 8c.
- [ ] Users changing their own password (`PATCH /auth/me/password`).
- [x] Hide the password as it's typed (`src/cli/password-prompt.ts`, raw mode on a terminal, one line per question when piped; asked twice). Used by `create-user` and `reset-password`.
- [x] `npm run user:reset-password -- --email <email> [--activate]` (`src/cli/reset-password.ts`) for when nobody can log in to use `/admin/users/:id/password`. Added 2026-11-10.
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
