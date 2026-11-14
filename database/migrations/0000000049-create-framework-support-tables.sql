-- Two tables the framework reads that this app never had a migration for.
--
-- `payment_webhook_events` is where @stacksjs/payments remembers the Stripe
-- events it has already handled, by provider and event id. Without the table a
-- redelivered event is recognised only inside the process that saw it first,
-- so a restart between two deliveries handles the same event twice.
--
-- `queue_workers` is where each queue worker writes its heartbeat. Without it
-- the worker logs "Queue worker telemetry unavailable" and the dashboard has
-- no workers to show.
--
-- Why they were absent: both arrived in the framework after this app was
-- created, and an app with its own app/Models does not receive the framework's
-- model migrations. Production applies committed files and generates none.
--
-- Hand-written and additive; no app/Models/*.ts. Same shape as the
-- framework's own migrations for these tables.
--
-- `heartbeat_at` is milliseconds since the epoch, which does not fit a
-- Postgres integer, so it is a bigint here.
CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "provider" varchar(255) NOT NULL,
  "event_id" varchar(255) NOT NULL,
  "processed_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_provider_event_unique" ON "payment_webhook_events" ("provider", "event_id");

CREATE TABLE IF NOT EXISTS "queue_workers" (
  "worker_id" varchar(255) PRIMARY KEY,
  "snapshot" text NOT NULL,
  "heartbeat_at" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "queue_workers_heartbeat_at_index" ON "queue_workers" ("heartbeat_at");
