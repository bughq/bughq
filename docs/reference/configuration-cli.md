---
title: Configuration and CLI
description: Important environment variables and Buddy commands for BugHQ operators.
---

# Configuration and CLI

## Environment variables

| Area | Variables |
| --- | --- |
| Application | `APP_NAME`, `APP_ENV`, `APP_KEY`, `APP_URL`, `DEBUG` |
| Database | `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` |
| Mail | `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` |
| Queue | `QUEUE_DRIVER`, `QUEUE_CONCURRENCY`, `QUEUE_WORKER_CONCURRENCY` |
| Proxy | `TRUSTED_PROXY_HOPS` |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| GitHub | `GITHUB_TOKEN` |
| AI | `AI_DRIVER`, driver-specific API key, model, host, and token values |
| Autofix | `AI_AUTOFIX_ENABLED`, `AI_AUTOFIX_DRAFT`, `AI_AUTOFIX_MAX_FILES`, `AI_AUTOFIX_MAX_SOURCE_BYTES`, `AI_AUTOFIX_BRANCH_PREFIX` |

Start with `.env.example`. Never commit plaintext production secrets. BugHQ supports encrypted environment files for deployment.

## Common commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install locked dependencies |
| `bun run dev` | Start the local site and API |
| `./buddy key:generate` | Generate application environment keys |
| `./buddy migrate` | Apply pending database migrations |
| `./buddy generate:migrations` | Generate model-driven migration changes |
| `./buddy build docs` | Build the BunPress documentation site |
| `./buddy test` | Run the test suite |
| `bun run typecheck` | Run TypeScript checks |
| `bunx --bun pickier .` | Check repository formatting and lint rules |

Run migrations as an explicit deployment step after production secrets are available and before the new application release begins serving requests.
