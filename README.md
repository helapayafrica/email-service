# NVO Email Service

A NestJS backend for the contact forms of several company websites. It
validates and stores submissions in PostgreSQL, queues delivery through Bull and
Redis, and sends formatted HTML and plain-text email over SMTP. A dashboard API
lets company staff log in and read their company's submissions.

## Features

- Companies (sites) managed in the database by super-admins: each has its own
  API key, recipient, and optionally its own SMTP server and From address
- API keys stored as a hash plus an encrypted copy; SMTP passwords encrypted
- Dashboard login with JWT: company users see only their companies, super-admins
  see everything
- Paginated, searchable list of contact requests per company
- Required contact details: full name, email, phone number, and message;
  optional company and subject
- Idempotency protection against duplicate submissions
- Immediate `202 Accepted` while queueing and delivery continue in the
  background, with retries and exponential backoff
- HTML-safe responsive email template with a plain-text fallback
- Helmet, configurable CORS, request throttling, and consistent error responses
- OpenAPI documentation presented through Scalar at `/docs`
- Mailpit inbox for local SMTP testing without sending real email

## Documentation

- [Project guide](docs/PROJECT.md): configuration, API, architecture,
  troubleshooting
- [VPS production deployment](docs/VPS_DEPLOYMENT.md)
- [VPS deployment using only an IP address](docs/VPS_IP_DEPLOYMENT.md)
- [Upgrading a server from the env-based site setup](docs/DEPLOY_DASHBOARD_AUTH.md)
- Interactive API reference: `http://localhost:3000/docs`

## Requirements

- Node.js 24+
- npm
- Docker with the Compose plugin for local PostgreSQL, Redis, and Mailpit
- `jq` for the command-line examples below (optional)

## Local setup

```bash
cp .env.example .env
npm install
```

Two secrets in `.env` must be filled in before the stack will start. Generate
them and paste each value after its `=`:

```bash
openssl rand -base64 48   # JWT_SECRET: signs login tokens
openssl rand -base64 32   # SITE_SECRETS_KEY: encrypts site secrets in the database
```

Then start everything:

```bash
npm run services:up
```

Open:

- API: `http://localhost:3000`
- Scalar documentation: `http://localhost:3000/docs`
- Mailpit inbox: `http://localhost:8025`

This one command builds and starts the API, waits for PostgreSQL and Redis,
applies pending migrations, starts NestJS, and adds Mailpit for local SMTP. Mailpit
is defined only in `docker-compose.dev.yml` and must not be used in production.

## Try it out

The commands below use this shortcut for the local Compose stack:

```bash
dc() { docker compose -f docker-compose.yml -f docker-compose.dev.yml "$@"; }
```

**1. Create a super-admin.** There is no public sign-up; accounts are created
from the command line. The command prompts for a password (at least 12
characters; it is shown as you type).

```bash
dc exec app npm run user:create:prod -- --email admin@example.com --name "Admin" --role super_admin
```

**2. Log in.**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<your password>"}' | jq -r .accessToken)
```

**3. Create a site.** The response contains the site's API key; the website
sends it as `x-api-key`. Without `smtp*` fields the site uses the global SMTP
settings, which locally means Mailpit.

```bash
API_KEY=$(curl -s -X POST http://localhost:3000/admin/sites \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"deliva","name":"Deliva Fasta","recipient":"contact@example.com"}' | jq -r .apiKey)
echo "$API_KEY"
```

**4. Submit a contact form** as the website would:

```bash
curl -X POST http://localhost:3000/contact \
  -H 'Content-Type: application/json' \
  -H "x-api-key: $API_KEY" \
  -H 'idempotency-key: contact-test-001' \
  -d '{
    "siteId": "deliva",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phoneNumber": "+254700000000",
    "company": "Acme Ltd",
    "subject": "Website enquiry",
    "message": "Hello, I would like to learn more about your services."
  }'
```

The email appears in Mailpit at `http://localhost:8025`. Use a new
`idempotency-key` for each new submission; reusing one returns the existing
request and does not queue a duplicate email.

**5. Read it back** as the dashboard would:

```bash
curl -s http://localhost:3000/requests -H "Authorization: Bearer $TOKEN" | jq
```

Everything above can also be done in the browser at `/docs`: log in with
`POST /auth/login`, then paste the `accessToken` under *Authentication*.

## Useful commands

```bash
npm run services:up     # Build/start API, PostgreSQL, Redis, and Mailpit
npm run services:down   # Stop the complete local stack
npm run services:logs   # Follow API container logs
npm run prod:up         # Build/start the production stack
npm run prod:down       # Stop the production stack
npm run prod:logs       # Follow production API logs
npm run migration:run   # Build and apply pending migrations
npm run migration:show  # Show migration status
npm run user:create     # Create a dashboard user (on the host; user:create:prod in a container)
npm run build           # Compile the production application
npm run lint            # Run static analysis
npm test                # Run isolated unit tests
npm run test:cov        # Run tests with coverage
```

See [docs/PROJECT.md](docs/PROJECT.md) for configuration, architecture, API, and
troubleshooting details.
