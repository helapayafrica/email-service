# Deploy to a VPS using only its IP address

This guide deploys the complete service without a domain name. Replace
`203.0.113.10` with the VPS's real, static public IPv4 address everywhere.

The production stack contains:

- the NestJS API;
- PostgreSQL;
- Redis and the Bull worker;
- Nginx on the VPS as the public reverse proxy.

Mailpit is not started in production. The application uses a real SMTP provider.

## Important: HTTP versus HTTPS

An API available at `http://203.0.113.10` can be used for command-line testing,
but an HTTPS company website normally cannot call it from browser JavaScript.
Browsers block an HTTPS page from making an insecure HTTP API request as mixed
content.

For contact forms on HTTPS websites, use the HTTPS section in this guide. As of
2026, Let's Encrypt supports publicly trusted IP-address certificates. These are
short-lived certificates valid for about six days, so automatic renewal is
mandatory. Certbot 5.4 or newer supports IP certificates in webroot mode but does
not automatically install them into Nginx; the Nginx certificate paths must be
configured manually.

## 1. Connect to and prepare the VPS

Connect using the VPS user supplied by the hosting provider:

```bash
ssh your-user@203.0.113.10
```

Install updates and basic packages:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx ufw
```

Configure the firewall before enabling it:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Only SSH (`22`), HTTP (`80`), and HTTPS (`443`) should be public. Do not publish
PostgreSQL, Redis, Mailpit, or the Docker daemon.

## 2. Install Docker Engine and Compose

Install Docker from its official Ubuntu repository:

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

The commands below retain `sudo`. Adding a user to the `docker` group grants
root-equivalent control over the host and should be a deliberate decision.

## 3. Copy the application to the VPS

```bash
sudo mkdir -p /opt/nvo-email-service
sudo chown "$USER":"$USER" /opt/nvo-email-service
git clone <YOUR_GIT_REPOSITORY_URL> /opt/nvo-email-service
cd /opt/nvo-email-service
```

For a private repository, use a read-only deployment key rather than copying a
personal SSH key to the server.

## 4. Configure production values

Create the production environment file from the safe template:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit it:

```bash
nano .env.production
```

For an initial HTTP-only deployment, use:

```env
NODE_ENV=production
PORT=3000
APP_URL=http://203.0.113.10

DB_USER=emailservice
DB_PASS=REPLACE_WITH_A_LONG_RANDOM_DATABASE_PASSWORD
DB_NAME=emailservice

SMTP_HOST=smtp.production-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=REPLACE_WITH_SMTP_USERNAME
SMTP_PASS=REPLACE_WITH_SMTP_PASSWORD
SMTP_FROM=Website Contact <contact@example.com>

# These are the websites allowed to call the API from a browser. Do not put the
# API IP here unless a frontend is actually served from that IP.
CORS_ORIGINS=https://www.company-one.example,https://company-one.example
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=30

# Signs dashboard login tokens: openssl rand -base64 48
JWT_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_48
JWT_EXPIRES_IN_SECONDS=3600

# Encrypts site API keys and SMTP passwords in the database: openssl rand -base64 32
SITE_SECRETS_KEY=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_32
```

The Compose network supplies `DB_HOST=postgres`, `DB_PORT=5432`,
`REDIS_HOST=redis`, and `REDIS_PORT=6379` directly to the application container.
Do not replace those internal service names with the public VPS IP.

Never commit `.env.production`. Use real random values and keep a protected copy
in a password or secret manager.

Generate `JWT_SECRET` and `SITE_SECRETS_KEY` on the server with the commands in
their comments, and store both in your password manager. **Without
`SITE_SECRETS_KEY`, a database backup can't recover the sites' API keys and
SMTP passwords.** Compose refuses to start if either is missing.

Companies (sites) are not configured here. They are created in the database by
a super-admin after the stack is running (see "Create the first super-admin and
your sites" below).

## 5. Validate and start the production stack

Validate the merged configuration without printing secrets:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

Build and start the API, PostgreSQL, and Redis:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The API container waits for healthy PostgreSQL and Redis, applies pending
TypeORM migrations, and then starts NestJS.

Check the containers and application logs:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml ps
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 app
```

The Compose configuration binds NestJS to `127.0.0.1:3000`. It is reachable by
Nginx on the VPS but not directly from the internet.

Test it from the VPS:

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

## 6. Configure Nginx for the IP address

Create `/etc/nginx/sites-available/nvo-email-service`:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 32k;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

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

Create the ACME webroot, replace the default Nginx site, and enable this site:

```bash
sudo mkdir -p /var/www/certbot/.well-known/acme-challenge
sudo rm /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/nvo-email-service \
  /etc/nginx/sites-enabled/nvo-email-service
sudo nginx -t
sudo systemctl reload nginx
```

The removal command targets only Ubuntu's enabled default-site symlink. If that
path contains a real custom configuration, inspect it instead of removing it.

Verify HTTP externally:

```bash
curl --fail http://203.0.113.10/
curl --fail http://203.0.113.10/docs
```

At this stage, the API is available at `http://203.0.113.10`. Continue for HTTPS.

## 7. Obtain an HTTPS certificate for the IP

Install Certbot using its current official instructions and verify that it is
version 5.4 or newer:

```bash
certbot --version
```

Test issuance against Let's Encrypt staging first:

```bash
sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/certbot \
  --ip-address 203.0.113.10
```

After staging succeeds, request the trusted certificate by removing `--staging`:

```bash
sudo certbot certonly \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/certbot \
  --ip-address 203.0.113.10
```

The certificate files are normally created under:

```text
/etc/letsencrypt/live/203.0.113.10/fullchain.pem
/etc/letsencrypt/live/203.0.113.10/privkey.pem
```

IP certificates expire after roughly six days. Do not proceed unless automatic
renewal can run reliably.

## 8. Enable HTTPS in Nginx

Replace the Nginx file with these two server blocks:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate /etc/letsencrypt/live/203.0.113.10/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/203.0.113.10/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

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

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Change `.env.production` to the secure public URL:

```env
APP_URL=https://203.0.113.10
```

Recreate only the application to apply that environment change:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps --force-recreate app
```

## 9. Configure automatic certificate renewal

Create an Nginx reload hook:

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Confirm Certbot's systemd timer is enabled and test renewal:

```bash
sudo systemctl enable --now certbot.timer
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Because the IP certificate lasts only about six days, monitor renewal rather
than assuming it works. Check the timer and certificate expiry regularly.

## 10. Test the public API

Health and documentation:

```bash
curl --fail https://203.0.113.10/
curl --fail https://203.0.113.10/docs
```

Submit a production contact test:

```bash
curl --fail-with-body --request POST \
  'https://203.0.113.10/contact' \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: REPLACE_WITH_THE_SITE_APIKEY_FROM_ADMIN_SITES' \
  --header "idempotency-key: $(uuidgen)" \
  --data-raw '{
    "siteId": "deliva",
    "fullName": "VPS Test",
    "email": "sender@example.com",
    "phoneNumber": "+254700000000",
    "subject": "IP deployment test",
    "message": "This message verifies the VPS IP deployment."
  }'
```

The expected response is `202 Accepted`. Confirm that the real recipient receives
the email and inspect logs if delivery fails:

```bash
sudo docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 app
```

## 11. Update the deployment

Back up PostgreSQL first, then deploy reviewed changes:

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
curl --fail https://203.0.113.10/
```

The application startup applies pending migrations automatically.

## 12. IP-only production checklist

- [ ] The VPS has a static public IP.
- [ ] SSH, HTTP, and HTTPS are the only intended public ports.
- [ ] PostgreSQL and Redis are not published to the host.
- [ ] `.env.production` is protected with mode `600`.
- [ ] `APP_URL` uses the public IP and correct scheme.
- [ ] `CORS_ORIGINS` lists the calling company websites (and the dashboard, once deployed), not arbitrary origins.
- [ ] Mailpit is absent and real SMTP is configured.
- [ ] The IP certificate is trusted and its short-lived renewal is monitored.
- [ ] Nginx proxies to `127.0.0.1:3000`.
- [ ] Database backups are automated and copied off the VPS.
- [ ] A real contact request returns `202` and delivers successfully.
- [ ] `JWT_SECRET` and `SITE_SECRETS_KEY` are stored in a password manager, separately from the database backups.
- [ ] Only the people who run the service are super-admins; company staff have company-user accounts.

## Official references

- Let's Encrypt IP certificates:
  https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability
- Certbot IP certificate instructions:
  https://letsencrypt.org/2026/03/11/shorter-certs-certbot
- Docker port publishing:
  https://docs.docker.com/engine/network/port-publishing/
