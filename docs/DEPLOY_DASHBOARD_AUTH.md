# Deploy: dashboard login and database-managed sites

This guide upgrades a server that already runs the service (set up with
[`VPS_DEPLOYMENT.md`](VPS_DEPLOYMENT.md) or
[`VPS_IP_DEPLOYMENT.md`](VPS_IP_DEPLOYMENT.md)) to the `feature/dashboard-auth`
release. Follow it once, in order. Allow about 20 minutes.

## What this release changes

| Area | Change |
|---|---|
| Database | Four new migrations: `users` table, user roles and sites, an index on `contact_requests`, and the `sites` table. They are additive: existing tables and data are not changed. |
| Sites | Companies now live in the `sites` table instead of the `SITE_*` env vars. Each site's API key is stored as a hash plus an encrypted copy. A site can have its own SMTP server. |
| Dashboard API | `POST /auth/login`, `GET /auth/me`, `GET /requests`, `GET /requests/:id`, and for super-admins `/admin/sites` (create, edit, deactivate, rotate and reveal keys), all using a bearer token. |
| Configuration | Three new env vars: `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`, `SITE_SECRETS_KEY`. Compose refuses to start without `JWT_SECRET` and `SITE_SECRETS_KEY`. |
| Websites | Nothing changes for them. Each site keeps its current API key, so contact forms keep working. |

**The one step that can't be skipped is the site import (step 5).** The new
code reads sites only from the database. Until the import has run, every
website's contact form gets `401 Invalid API key or site`. The order below runs
the import *before* the new code goes live, so the websites see no downtime.

## Before you start

- The release is merged to `main` and pushed, and the checks pass locally:
  ```bash
  npm run build && npm run lint && npm test
  ```
- You can SSH to the server and run `sudo docker compose`.
- You have a password manager entry ready for two new secrets.
- `jq` is installed on the server for the smoke tests (`sudo apt install -y jq`).

All commands run on the server, from the app directory. To keep them short,
define this helper in your SSH session first:

```bash
cd /opt/nvo-email-service
dcp() { sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml "$@"; }
```

## 1. Back up the database

```bash
mkdir -p backups
set -a; . ./.env.production; set +a
dcp exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | gzip > "backups/emailservice-$(date +%F-%H%M%S).sql.gz"
ls -lh backups | tail -1   # should not be a few bytes
```

Also note the commit that's live now, for rollback:

```bash
git rev-parse --short HEAD
```

## 2. Add the new secrets to `.env.production`

Generate two **new** values. Don't reuse your local `.env` values.

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "SITE_SECRETS_KEY=$(openssl rand -base64 32)"
```

Add them to `.env.production` along with the token lifetime:

```bash
sudo nano .env.production
```

```env
# Signs dashboard login tokens.
JWT_SECRET=<the 64-character value from above>
JWT_EXPIRES_IN_SECONDS=3600

# Encrypts per-site secrets (API keys, SMTP passwords) in the database.
SITE_SECRETS_KEY=<the 44-character value from above>
```

Then:

- **Save both values in your password manager now.** If `SITE_SECRETS_KEY` is
  lost, the stored API keys and SMTP passwords can't be decrypted. You would
  have to re-enter every site's SMTP password and issue new API keys to every
  website. A database backup is useless without this key.
- **Keep every `SITE_DELIVA_*`, `SITE_ALUMNI_*` and `SITE_VOLTIC_*` line.** The
  import in step 5 reads them, and rollback needs them. They're removed in a
  later release.
- Make sure each site's `_APIKEY` and `_RECIPIENT` are filled in. A site with
  either one empty is skipped by the import.

Check the file and permissions:

```bash
chmod 600 .env.production
dcp config --quiet && echo "config ok"
```

`required variable JWT_SECRET is missing a value` or the same for
`SITE_SECRETS_KEY` means a line is missing or misspelled.

## 3. Get the new code

```bash
git fetch origin
git log --oneline HEAD..origin/main   # review what's coming
git pull --ff-only
```

## 4. Build the new image (the old container keeps running)

```bash
dcp build app
```

This only builds the image. The running container is not touched, so the
websites are still served by the old version.

## 5. Run the migrations and import the sites

This starts a one-off container from the **new** image, next to the old one:

```bash
dcp run --rm --no-deps app sh -c "npm run migration:run:prod && npm run site:import-env:prod"
```

Expected output (order may vary):

```text
Migration CreateUsers1794000000000 has been executed successfully.
Migration UserRolesAndSites1794100000000 has been executed successfully.
Migration ContactRequestsSiteIndex1794200000000 has been executed successfully.
Migration CreateSites1794300000000 has been executed successfully.
import deliva: Deliva Fasta -> contact@...
import alumni: Rongai Old Boys Alumni -> contact@...
import voltic: Voltic Africa Limited -> contact@...
```

- `skip <site>: its _APIKEY or _RECIPIENT env var is not set` means that site
  wasn't imported. Fix `.env.production` and run the same command again.
- The command is safe to repeat. Migrations already applied are skipped, and
  sites already in the table are never overwritten.

This is safe while the old version is live. The old code doesn't use the new
tables, and the only change to an existing table is an added index.

Check the result. Every site your websites use must be listed with `isActive = t`:

```bash
dcp exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, name, recipient, \"isActive\" from sites order by id"'
```

## 6. Switch to the new version

```bash
dcp up -d
dcp ps
dcp logs --tail=100 app
```

In the logs, look for:

- `No migrations are pending`
- `Default SMTP transport configured host=...`
- `Mapped {/auth/login, POST} route` and `Mapped {/requests, GET} route`
- `Nest application successfully started`

If you see `SITE_SECRETS_KEY must be 32 bytes`, the value was cut off when you
pasted it. Regenerate it, update `.env.production` and run `dcp up -d` again.
Nothing has been encrypted with a key yet if the app never started.

## 7. Smoke tests

**Health**

```bash
curl --fail http://127.0.0.1:3000/
```

**Contact form, once per site**, with the key that site already uses:

```bash
curl --fail-with-body -X POST http://127.0.0.1:3000/contact \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <SITE_DELIVA_APIKEY value>' \
  -H "idempotency-key: $(uuidgen || cat /proc/sys/kernel/random/uuid)" \
  -d '{"siteId":"deliva","fullName":"Deploy Test","email":"you@example.com",
       "phoneNumber":"+254700000000","subject":"Deploy test","message":"Checking the new release."}'
```

Expect `202` with `"status":"accepted"`, and the email in that site's inbox
within a few seconds. `dcp logs --tail=50 app` should show
`Contact email delivered ... siteId=deliva`. Repeat for `alumni` and `voltic`.

Also submit one form from each real website to confirm it end to end.

**Create the first super-admin.** The command prompts for the password, at
least 12 characters. The password is visible while you type it, so make sure
nobody can see your screen and clear it afterwards.

```bash
dcp exec app npm run user:create:prod -- --email you@yourcompany.com --name "Your Name" --role super_admin
clear
```

**Log in and call the dashboard API**

```bash
read -rsp 'Password: ' PW; echo
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"you@yourcompany.com\",\"password\":\"$PW\"}" | jq -r .accessToken)
unset PW
curl -s http://127.0.0.1:3000/auth/me -H "Authorization: Bearer $TOKEN" | jq .sites
curl -s 'http://127.0.0.1:3000/requests?limit=3' -H "Authorization: Bearer $TOKEN" | jq '{total, items: [.items[] | {siteName, status, createdAt}]}'
```

`/auth/me` should list every site, and `/requests` should show your test
submissions. Login allows 5 attempts per minute, so `429` means wait a minute.

**Company users** (optional now). One per person, limited to their companies:

```bash
dcp exec app npm run user:create:prod -- --email jane@deliva.com --name "Jane" --site deliva
```

**Manage sites** (optional). With the super-admin `$TOKEN` from above, or
interactively at `https://<your API host>/docs` under *Admin: sites*:

```bash
# List sites (never shows keys or SMTP passwords)
curl -s http://127.0.0.1:3000/admin/sites -H "Authorization: Bearer $TOKEN" | jq

# Reveal a site's key, e.g. to configure its website
curl -s http://127.0.0.1:3000/admin/sites/deliva/api-key -H "Authorization: Bearer $TOKEN" | jq -r .apiKey

# Give a company its own mail server. Test it with one contact form afterwards.
curl -s -X PATCH http://127.0.0.1:3000/admin/sites/deliva -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"smtpHost":"smtp.deliva.com","smtpPort":587,"smtpUser":"mailer@deliva.com",
       "smtpPass":"<password>","smtpFrom":"Deliva Fasta <no-reply@deliva.com>"}' | jq .smtp
```

Avoid `rotate-key` on a live site unless you can update its website straight
away: the old key stops working immediately.

## 8. Finish

- Keep the backup from step 1 until the release has run cleanly for a few days.
- Record the deployed commit: `git rev-parse --short HEAD`.

## Rollback

All the schema changes in this release are additive, and the `SITE_*` env vars
are still in place. That means the previous version runs against the new
database unchanged.

```bash
git checkout <commit from step 1>
dcp up -d --build
```

- **Don't** run `migration:revert` and don't restore the backup just to roll
  back the code. Neither is needed, and both can lose data written since the
  deploy.
- The old version reads sites from `SITE_*` again, so any site added or edited
  in the database after the deploy is unknown to it.
- Return to the release with `git checkout main && dcp up -d --build`. There's
  no need to re-run step 5, because the tables and sites are still there.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Every website gets `401 Invalid API key or site` | The site isn't in the `sites` table or is inactive. Re-run step 5 and check its output, then check the `select ... from sites` query. |
| One site gets `401` | That site's `_APIKEY` in `.env.production` differs from the key on its website. The import stored the env value. Fix the env value, delete the row (`delete from sites where id='<id>'`) and re-run step 5. |
| `400 Unknown or unconfigured site` | The site exists but is inactive (`isActive = f`). |
| Request saved but status `failed`; logs show `Site <id> does not exist or is inactive` | The site was deactivated or removed after the form was submitted. Reactivate it. Failed jobs aren't retried automatically after all 5 attempts. |
| Logs show SMTP `EAUTH` or connection errors for one site | That site's own SMTP settings are wrong. Sites without their own SMTP use the global `SMTP_*` settings. |
| App restarts with `SITE_SECRETS_KEY must be set` or `must be 32 bytes` | The variable is missing or truncated in `.env.production`. |
| `user:create:prod` says `Unknown site(s): ...` | The `--site` id isn't in the `sites` table. Use an id from the step 5 query. |
| Login returns `429` | The login limit is 5 attempts per minute per IP. Wait a minute. |

## Not in this release yet

These are planned in [`DASHBOARD_AUTH_PLAN.md`](DASHBOARD_AUTH_PLAN.md):

- **Removing the `SITE_*` env vars.** Do this only after the release has run
  cleanly, because rollback needs them.
- **Dashboard frontend.** When it exists, add its origin to `CORS_ORIGINS`.
  The `Authorization` header is already allowed.
- **Maintenance:** `dotenv` is used by the CLIs and the migration data source
  but is only installed indirectly, through `@nestjs/config`. Add it to
  `dependencies` in `package.json` so a future upgrade can't silently remove it.
