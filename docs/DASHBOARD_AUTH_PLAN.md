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
- [ ] **Step 6: configuration and docs.**
  - Production `.env.production`: generate a fresh `JWT_SECRET` with `openssl rand -base64 48`.
  - Add the dashboard's origin to `CORS_ORIGINS`.
  - Update `docs/VPS_DEPLOYMENT.md` and `docs/VPS_IP_DEPLOYMENT.md`: the JWT settings, plus creating the first super-admin on the server with `docker compose ... exec app npm run user:create:prod -- --email ... --name ... --role super_admin`.
  - Update `docs/PROJECT.md` (the API section and environment variable table), `README.md` and `CLAUDE.md`.
- [ ] **Step 7: tests.** Unit tests, following the hand-rolled `vi.fn()` style of the existing specs:
  - `UserService.create` validation: role, at least one site for a company user, unknown site, password length, duplicate email (`23505`).
  - `AuthService.login`: success, wrong password, unknown email, inactive user.
  - `JwtAuthGuard`: missing token, bad token, inactive or deleted user.
  - `site-access.ts`.
  - The requests service scoping: a company user can't read another site's requests, and a super-admin can read every site's requests.
- [ ] **Merge** `feature/dashboard-auth` into `main` and push. Deploy, which runs the migrations automatically.

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
