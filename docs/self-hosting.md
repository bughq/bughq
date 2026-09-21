---
title: Self-hosting
description: Run BugHQ on your own infrastructure.
---

# Self-hosting

BugHQ is a Bun and Stacks application with a dashboard server, API server, relational database, mail delivery, and optional queue, billing, alerts, and Autofix integrations.

## Requirements

- Bun 1.3 or newer
- SQLite 3.47.2 or newer for local development
- PostgreSQL for the production configuration
- A reverse proxy with TLS
- SMTP or another configured mail transport for invitations and email alerts
- A durable queue driver when background work must survive process restarts

## Local setup

```bash
git clone https://github.com/stacksjs/bughq.git
cd bughq
bun install
cp .env.example .env
./buddy key:generate
./buddy migrate
bun run dev
```

The default development setup serves the frontend on port 3100 and the API on port 3108.

## Production checklist

1. Set `APP_ENV=production`, `APP_URL`, and a generated `APP_KEY`.
2. Configure PostgreSQL and apply migrations before serving traffic.
3. Configure mail and a persistent queue driver.
4. Put both application processes behind the same HTTPS origin.
5. Set `TRUSTED_PROXY_HOPS` to match the proxy topology.
6. Configure backups, monitoring, health checks, and log retention.
7. Add Stripe only if the deployment uses hosted-style plan enforcement.
8. Add GitHub and AI credentials only if Autofix is enabled.

Use `GET /health` or `GET /api/health` for service checks. A deployment should verify database connectivity, event ingestion, dashboard access, mail, queues, and one alert channel before accepting production traffic.

## Build these docs

```bash
./buddy build docs
```

BunPress writes the static site to `dist/docs/.bunpress` for deployment at `/docs`.
