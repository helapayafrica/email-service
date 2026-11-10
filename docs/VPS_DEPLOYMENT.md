# Deploy to an Ubuntu VPS

If the server will be accessed only by its public IP address, use
[VPS_IP_DEPLOYMENT.md](VPS_IP_DEPLOYMENT.md) instead.

This guide deploys the API, PostgreSQL, and Redis on one Ubuntu VPS with Docker
Compose. Nginx terminates HTTPS and proxies traffic to the API bound only to
`127.0.0.1:3000`. Mailpit is not deployed.

Replace every example domain, username, password, and key before deployment.

## 1. Prepare DNS and the server

Create a DNS `A` record such as `email-api.example.com` pointing to the VPS IPv4
address. Add an `AAAA` record only if IPv6 is correctly configured.

SSH into the VPS with a sudo-capable, non-root user, install security updates,
and configure the host firewall:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Do not expose PostgreSQL (`5432`), Redis (`6379`), or the Docker daemon to the
internet. Docker-published ports can bypass normal UFW handling, which is why the
production Compose example below publishes only the API and binds it explicitly
to `127.0.0.1`.

## 2. Install Docker Engine and Compose

Use Docker's official Ubuntu repository rather than the convenience script:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Either keep using `sudo docker ...`, or deliberately configure Docker access for
the deployment user. Membership in the `docker` group is effectively root-level
access and should not be granted casually.

## 3. Copy the application

Choose a stable location and clone the repository:

```bash
sudo mkdir -p /opt/nvo-email-service
sudo chown "$USER":"$USER" /opt/nvo-email-service
git clone <YOUR_GIT_REPOSITORY_URL> /opt/nvo-email-service
cd /opt/nvo-email-service
```

For a private repository, use a read-only deploy key. Do not copy a developer's
personal SSH key onto the server.

## 4. Create production secrets

Copy the included template and restrict it:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Add values similar to these:

```env
NODE_ENV=production
PORT=3000
APP_URL=https://email-api.example.com

DB_HOST=postgres
DB_PORT=5432
DB_USER=emailservice
DB_PASS=REPLACE_WITH_A_LONG_RANDOM_DATABASE_PASSWORD
DB_NAME=emailservice

REDIS_HOST=redis
REDIS_PORT=6379

SMTP_HOST=smtp.production-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=REPLACE_WITH_SMTP_USERNAME
SMTP_PASS=REPLACE_WITH_SMTP_PASSWORD
SMTP_FROM=Website Contact <contact@example.com>

CORS_ORIGINS=https://www.company-one.example,https://company-one.example
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=30

# Signs dashboard login tokens: openssl rand -base64 48
JWT_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_48
JWT_EXPIRES_IN_SECONDS=3600

# Encrypts site API keys and SMTP passwords in the database: openssl rand -base64 32
SITE_SECRETS_KEY=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_32
```

Use a password manager or secret manager to generate and retain strong values.
Never use Mailpit values or commit `.env.production`.

Generate `JWT_SECRET` and `SITE_SECRETS_KEY` on the server with the commands in
their comments, and store both in your password manager. **Without
`SITE_SECRETS_KEY`, a database backup can't recover the sites' API keys and
SMTP passwords.** Compose refuses to start if either is missing.

Companies (sites) are not configured here. They are created in the database by
a super-admin after the stack is running (see "Create the first super-admin and
your sites" below).

SMTP settings depend on the provider. Port `587` commonly uses STARTTLS with
`SMTP_SECURE=false`; implicit TLS commonly uses port `465` with
`SMTP_SECURE=true`. Follow the provider's exact instructions and configure SPF,
DKIM, and DMARC for the sender domain to improve deliverability.

## 5. Start the production Compose stack

The repository includes `docker-compose.yml` with the API, PostgreSQL, and Redis,
plus `docker-compose.prod.yml` with production restart/image settings. Mailpit is
only present in `docker-compose.dev.yml` and is therefore absent from production.
PostgreSQL and Redis have no host ports and remain on the private Compose network.

Validate and start the stack:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml ps
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 app
```

The image's startup command applies pending TypeORM migrations before starting
NestJS. If migration execution fails, the API does not start; inspect the app logs
and fix the database or migration issue rather than bypassing it.

Verify locally on the VPS:

```bash
curl --fail http://127.0.0.1:3000/
```

### Create the first super-admin and your sites

There is no public sign-up. Create the first account inside the app container.
The command prompts for a password (at least 12 characters). The password is
visible while you type it, so clear the screen afterwards.

```bash
sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml exec app npm run user:create:prod -- --email you@yourcompany.com --name "Your Name" --role super_admin
clear
```

Log in and create a site for each company website. The `id` is permanent and
is what the website sends as `siteId`. Install `jq` first (`sudo apt install -y jq`).

```bash
read -rsp 'Password: ' PW; echo
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"you@yourcompany.com\",\"password\":\"$PW\"}" | jq -r .accessToken)
unset PW

curl -s -X POST http://127.0.0.1:3000/admin/sites \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"deliva","name":"Deliva Fasta","recipient":"contact@company-one.example"}' | jq
```

The response includes `apiKey`. Configure that website to send it as
`x-api-key`. You can reveal it again later with
`GET /admin/sites/<id>/api-key`. To send a company's email through its own mail
server, add `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, and `smtpFrom`. See
[PROJECT.md](PROJECT.md#managing-sites). These steps can also be done in the
browser at `/docs`.

Create logins for company staff, one per person, limited to their companies:

```bash
curl -s -X POST http://127.0.0.1:3000/admin/users -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"jane@company-one.example","fullName":"Jane","role":"company_user",
       "siteIds":["deliva"],"password":"<initial password, 12+ characters>"}' | jq
```

Change a user's companies, deactivate them, or reset a password later with
`PATCH /admin/users/:id` and `POST /admin/users/:id/password`. Company users
can set their companies' CC lists themselves (`PUT /sites/:id/cc`). See
[PROJECT.md](PROJECT.md#users).

## 6. Configure Nginx

Create `/etc/nginx/sites-available/nvo-email-service`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name email-api.example.com;

    client_max_body_size 32k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }
}
```

Enable and validate it:

```bash
sudo ln -s /etc/nginx/sites-available/nvo-email-service \
  /etc/nginx/sites-enabled/nvo-email-service
sudo nginx -t
sudo systemctl reload nginx
```

If the default Nginx site conflicts with this host, remove only its enabled
symlink after checking the active configuration.

## 7. Enable HTTPS

Install Certbot using the current method recommended for the VPS distribution,
then request a certificate for the API hostname. With the Ubuntu Nginx packages,
a common flow is:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d email-api.example.com
sudo certbot renew --dry-run
```

Certbot needs the DNS record to resolve to this VPS and ports 80/443 to be
reachable. Confirm that `https://email-api.example.com/` returns the health text.

Optionally restrict `/docs` in Nginx by IP address or HTTP authentication if the
interactive API reference should not be public.

## 8. Production smoke test

Use the `apiKey` of a site you created and a new idempotency UUID:

```bash
curl --fail-with-body --request POST \
  'https://email-api.example.com/contact' \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: REPLACE_WITH_THE_SITE_KEY' \
  --header "idempotency-key: $(uuidgen)" \
  --data-raw '{
    "siteId": "deliva",
    "fullName": "Production Test",
    "email": "sender@example.com",
    "phoneNumber": "+254700000000",
    "subject": "VPS deployment test",
    "message": "This message verifies the production contact-email flow."
  }'
```

Confirm that the API reports `queued`, the configured recipient receives the
message, and the container logs contain no delivery error:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 app
```

## 9. Backups

Back up PostgreSQL before deployments and on a schedule. This example creates a
compressed logical dump outside the Docker volume:

```bash
mkdir -p backups
set -a
. ./.env.production
set +a
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "backups/emailservice-$(date +%F-%H%M%S).sql.gz"
```

Copy encrypted backups off the VPS and test restoration periodically. Keep
`SITE_SECRETS_KEY` safe separately: restored sites' API keys and SMTP passwords
can only be decrypted with it. A backup
that has never been restored is not yet proven. Redis contains queue state, but
PostgreSQL is the essential durable business record.

## 10. Deploy updates

Review the incoming changes and migrations, create a database backup, then:

Upgrading a server that still configures sites with `SITE_<ID>_*` variables
(before the dashboard release) needs extra one-time steps: new secrets and a
site import. Follow [DEPLOY_DASHBOARD_AUTH.md](DEPLOY_DASHBOARD_AUTH.md) for
that upgrade instead of the commands below.

```bash
cd /opt/nvo-email-service
git pull --ff-only
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml ps
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 app
curl --fail https://email-api.example.com/
```

Compose replaces the application container and preserves named data volumes.
Prune old images only after verifying the release and understanding what will be
removed.

## 11. Rollback

Application rollback:

1. Identify the previously deployed Git commit or release tag.
2. Check whether the new release ran a backward-incompatible migration.
3. Restore the pre-deployment database backup if required.
4. Check out the previous release and rebuild the app container.
5. Run the health and contact-form smoke tests again.

Do not blindly run `migration:revert` in production: a down migration can destroy
new data. Prefer a reviewed forward-fix when data has already been written under
the new schema.

## Operational checklist

- [ ] DNS points to the correct VPS.
- [ ] Only SSH, HTTP, and HTTPS are intentionally public.
- [ ] PostgreSQL and Redis have no public host ports.
- [ ] `.env.production` is mode `600` and is not committed.
- [ ] Mailpit is absent from production.
- [ ] Real SMTP, SPF, DKIM, and DMARC are configured.
- [ ] `CORS_ORIGINS` contains only real website origins, plus the dashboard's origin once it is deployed.
- [ ] HTTPS works and certificate renewal has been tested.
- [ ] Database backups run automatically and copies leave the VPS.
- [ ] Logs and disk usage are monitored.
- [ ] The health endpoint and a real contact submission pass after deployment.
- [ ] `JWT_SECRET` and `SITE_SECRETS_KEY` are stored in a password manager, separately from the database backups.
- [ ] Only the people who run the service are super-admins; company staff have company-user accounts.

## Reference documentation

- Docker Engine on Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- Docker Compose in production: https://docs.docker.com/compose/how-tos/production/
- Compose dependency health checks: https://docs.docker.com/compose/how-tos/startup-order/
- Docker port publishing: https://docs.docker.com/engine/network/port-publishing/
- Certbot instructions: https://certbot.eff.org/instructions
