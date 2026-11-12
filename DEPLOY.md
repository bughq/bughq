# Deploying bughq

bughq is **attached to the statushq Hetzner server** and shipped by **ts-cloud**
(`buddy deploy` → `@stacksjs/ts-cloud`), with DNS at **Porkbun** and
push-to-deploy from **GitHub Actions**. `config/cloud.ts` gives it no server of
its own; see [Topology](#topology).

There is no AWS and no RDS in this path. `config/cloud.ts` still carries
AWS-shaped keys (`region`, `loadBalancer`, `containers`, `ssl.provider: 'acm'`,
`storage`, `queues`) and `cloud/servers.ts` still describes EC2 instances,
because the config type and the scaffold are shared across providers. Nothing
reads them once `cloud.provider` is `hetzner`. Ignore them.

> This document is written from `config/cloud.ts`, `config/dns.ts` and
> `.github/workflows/deploy.yml` as committed. It was not checked against the
> live box. Anything marked **unverified** is what the configuration implies,
> not something observed. See [Known inconsistencies](#known-inconsistencies)
> for the places where the repository disagrees with itself.

## Topology

`config/cloud.ts` sets:

```ts
cloud: {
  provider: 'hetzner',
  attachTo: 'uptime-status',
},
```

So bughq deploys onto the box the statushq project owns, as an additional set
of sites.

The slug is **`uptime-status`**, not `statushq`. `attachTo` takes the owner
project's slug, and ts-cloud matches it against the server's `ts-cloud/project`
label. The server is *named* `statushq-production-app` but its label reads
`uptime-status`. `attachTo: 'statushq'` fails with "Attach target 'statushq' has
no reachable box for 'production'", which reads like the server is down when it
is running fine.

| Piece | Detail |
|---|---|
| Server | `statushq-production-app`, owned by statushq, not created by this repo |
| Edge | **rpx** (`compute.webServer` and `compute.proxy.engine`), TLS issued on demand (`onDemandTls: true`) |
| Database | PostgreSQL on the same box, `localhost:5432`, database and role `bughq` (`compute.database`) |
| App | `main` site, `bun node_modules/@stacksjs/buddy/dist/cli.js serve` on port **3022**, `memoryHigh: '1536M'` |
| API | `bughq-api` site, `bun node_modules/@stacksjs/actions/dist/serve/api.js` on **127.0.0.1:3023** |
| Docs | `docs` site, the static BunPress build in `dist/docs/.bunpress`, served at `/docs` |
| Layout | `/var/www/bughq-main/{shared,releases,current}` (the paths the workflow's post-deploy step uses) |

### PostgreSQL is a prerequisite

The comment beside `attachTo` in `config/cloud.ts` records that the statushq
box ran SQLite and had no PostgreSQL process when the attach was written.
bughq is Postgres only (`DB_CONNECTION=postgres`, `NOW()` in queries,
`BIGSERIAL` and `timestamptz` in migrations). ts-cloud creates the `bughq` role
and database inside an existing cluster, but in attach mode it skips
provisioning, so it does not install the cluster. PostgreSQL, and `pg_dump`
with it, must be on the box before the first attached deploy. Whether that has
been done is **unverified**.

### Ports

Nothing allocates or validates ports across the projects attached to one box,
so a collision shows up only as a service that will not bind. From each
project's own `config/cloud.ts`:

| Project | app / api |
|---|---|
| statushq (owner) | 3000 / 3008 |
| bughq | **3022 / 3023** |
| loghq | 3042 / 3043 |

Confirm on the box before a first deploy: `ss -ltnp | grep 30`.

### What attaching costs

The `HCLOUD_TOKEN` this repo's CI uses has to live in the same Hetzner project
as statushq, and Hetzner tokens have no per-resource scoping. bughq's CI can
therefore reach every server in that project. That is inherent to attaching.

## Sites

Sites are declared in the `tsCloud` **named export** of `config/cloud.ts`. The
file's `export default` is a separate, intentionally empty `CloudConfig`, so
editing the default export changes nothing about a deploy.

| Site key | Domain | Port | Role |
|---|---|---|---|
| `main` | `bughq.org` | 3022 | The app: stx views, the dashboard and the public ingest |
| `bughq-api` | none | 3023 | Loopback API (`HOST=127.0.0.1`). `main` reaches it through `API_URL=http://127.0.0.1:3023` |
| `docs` | `bughq.org/docs` | none | Static docs, built by `buddy build docs` during the deploy |
| `www` | `www.bughq.org` | none | Redirect to the apex |

The domain is `APP_DOMAIN`, falling back to `bughq.org`. Both processes run
`bun install` as their `preStart`.

In production only, `config/cloud.ts` adds the SMTP settings to both processes
(`MAIL_HOST=mail.bughq.org`, port 587, `noreply@bughq.org`) and takes
`MAIL_PASSWORD` from the `BUGHQ_SMTP_PASSWORD` environment variable of the
deploying process, so the credential is never committed.

## Branch to environment

| Branch | Environment | Domain | Flag passed to `buddy deploy` |
|---|---|---|---|
| `main` | production | `bughq.org` | `--prod` |
| `stage` | staging | `staging.bughq.org` | `--staging` |
| `dev` | development | `dev.bughq.org` | `--dev` |

**A push to `main` deploys production.** `workflow_dispatch` can pick an
environment by hand. Concurrency is grouped per branch and does not cancel a
run in progress, so two pushes queue rather than race.

## What a deploy does

`.github/workflows/deploy.yml`, in order:

1. `bun install --frozen-lockfile`, `bun run build`.
2. Two gates that stop a bad artifact before it ships: `bun run release:validate`,
   then `bun run serve:validate`, which renders pages the way production does.
3. Writes the SSH key from `DEPLOY_SSH_KEY` and derives its public half.
4. Recreates `.env.keys` on the runner from the `DOTENV_PRIVATE_KEY_*` secrets,
   so `buddy deploy` ships it and the box can decrypt the committed
   `.env.<environment>`.
5. For production, fails early if `BUGHQ_SMTP_PASSWORD` is not set.
6. `bun node_modules/@stacksjs/buddy/dist/cli.js deploy <flag> --yes`. The
   `./buddy` wrapper is not used in CI: it is built for the pantry layout.
7. Over SSH to the box named by `APP_SERVER_IP` (or `STAGING_SERVER_IP`):
   installs `.env.keys` into `/var/www/bughq-main/shared`, links it into the
   current release, and runs `buddy migrate --no-generate`.
8. For production, `bun run deployment:smoke` against `https://bughq.org`.

### Migrations

Step 7 applies only the SQL committed under `database/migrations/`. It answers
`Y` to running migrations and `n` to destructive drops, and `--no-generate`
keeps model diffing out of production. A failed migration fails the job on
purpose: the release is already live by then, so a red step is the alarm.

Migrations here are hand-written SQL, not generated from models: adding a model
for one of these tables makes the generator rewrite the rest (see the note at
the top of `0000000039`). A new file may need `git add --force`, because a
global gitignore that lists `*.sql` hides it from `git status`.

### Metering and the connect endpoints

Two tables back the free allowance and `buddy hq:connect`, both created by step
7 with no manual step and no new environment variable:

| Migration | Table | What it holds |
|---|---|---|
| `0000000047` | `hq_usage_counters` | Errors stored per account per month, in the shape `@stacksjs/hq/meter` counts into |
| `0000000048` | `hq_connect_codes` | Pending connect codes, hashed, each alive for ten minutes |

`0000000047` copies completed months out of the older `usage_counters` table
and leaves the month it runs in behind, so every account starts the enforced
allowance from zero on the day it ships. `usage_counters` is kept and no longer
written.

The allowance is `FREE_ERRORS_PER_MONTH` in `app/Billing/plans.ts`, which the
pricing page prints and the ingest enforces. Enforcement only applies when
`STRIPE_SECRET_KEY` is set; without it billing is off and nothing is limited.

The release is live before step 7 migrates. In that window the meter's flush
and the connect endpoints fail against the missing tables. Ingest is not
affected: counting happens in memory and a failed flush is logged and dropped.

## Secrets

Set these per GitHub **environment** (`production`, `staging`, `development`).
Values belong in GitHub and in the encrypted env files, never in this document.

| Secret | Used for |
|---|---|
| `DEPLOY_SSH_KEY` | Private key authorized on the box. One secret is enough; the public half is derived |
| `DOTENV_PRIVATE_KEY_PRODUCTION` | Decrypting `.env.production` |
| `DOTENV_PRIVATE_KEY_STAGING` | Decrypting `.env.staging` |
| `DOTENV_PRIVATE_KEY_DEVELOPMENT` | Decrypting `.env.development` |
| `HCLOUD_TOKEN` | Hetzner Cloud API, to find the attach target |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` | Porkbun DNS |
| `BUGHQ_SMTP_PASSWORD` | Production only. Becomes `MAIL_PASSWORD` for both processes |

## The encrypted env files

`.env.production`, `.env.staging` and `.env.development` are committed
encrypted (dotenvx style) and decrypted with the keys above. `.env.keys` is
gitignored and exists only on the runner and on the box.

These variables decide whether a deploy works:

| Variable | Why it matters |
|---|---|
| `APP_SERVER_IP` | Step 7 finds the box from it. If it is missing the step aborts and **migrations never run** |
| `STAGING_SERVER_IP` | The same, for staging |
| `DB_PASSWORD` | Without it `config/cloud.ts` falls back to a placeholder literal committed in that file, and that becomes the real database password |
| `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` | The Postgres connection the app uses on the box |
| `APP_DOMAIN` | Defaults to `bughq.org` |
| `APP_KEY`, `APP_URL` | The application key and public URL |

After attaching, `APP_SERVER_IP` has to be the statushq box's address, since
step 7 connects to whatever it says.

## DNS

Porkbun, managed by the deploy: the apex and `www` A records are upserted to
the box, and `config/dns.ts` is applied additively on top. That file declares
only the apex A record, pointed at `APP_SERVER_IP`.

## Deploying by hand

```sh
./buddy deploy --prod     # or --staging, --dev
```

This needs the same environment the workflow provides: `HCLOUD_TOKEN`, the
Porkbun keys, the `DOTENV_PRIVATE_KEY_*` for the environment, an SSH key
authorized on the box, and `BUGHQ_SMTP_PASSWORD` for production. It changes the
live service and live DNS. Prefer pushing to the branch.

## Local development

```sh
bun install
pantry install postgres && pantry start postgres
./buddy migrate
bun run dev
```

Migrations live in `database/migrations/`.

## Known inconsistencies

Places where the repository contradicts `config/cloud.ts`. Each one is a
question to settle against the live box, not a fact about it.

- **The workflow's header comment** in `.github/workflows/deploy.yml` says the
  app "runs on its OWN Hetzner box (config/cloud.ts has no `attachTo`)" and
  that the deploy provisions it. That comment predates the attach and is wrong
  about the config as committed.
- **`config/dns.ts` falls back to a literal address** when `APP_SERVER_IP` is
  unset. It is the address of the dedicated `bughq-production-app` server the
  attach was meant to replace, so an unset variable would point the apex at
  the old box rather than fail.
- **`TS_CLOUD_UI_DOMAIN: cloud.bughq.org`** is still passed to the deploy. In
  attach mode ts-cloud leaves the management dashboard to the server's owner,
  so this host is expected to be unused. **Unverified.**
- **`compute.managedServices: { postgres: true }`** asks for PostgreSQL to be
  installed, but attach mode skips provisioning (see above), so it does not
  make the prerequisite go away.
- **`storage/cloud/` is gitignored** for a reason: with a state file present,
  ts-cloud resolves the box recorded there and ignores `cloud.attachTo`. A
  stale state file on a machine that deploys by hand would keep shipping to the
  old server while reporting success.
- **The commit that added `attachTo`** described itself as not deployable until
  PostgreSQL was installed on the statushq box. Whether production is serving
  from that box today, or still from the dedicated server, is **unverified**.
