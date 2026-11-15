-- A triage-scoped project key, so a machine can change the status of this
-- project's issues without holding a person's credentials.
--
-- `read_key` beside it reads and cannot write. This one writes an issue's
-- status and reads nothing (app/Support/triage-key.ts): a release pipeline
-- that resolves what it fixed should hold neither somebody's session nor a
-- key that returns error data.
--
-- Nullable, issued on demand and revoked by setting it back to NULL, with a
-- partial unique index for the same reason as `read_key`: every project
-- without a key would otherwise collide on NULL.
--
-- `triage_key_last_used_at` is written at most once a minute per key, so
-- somebody can tell a key still in use from a forgotten one before revoking.
ALTER TABLE "projects" ADD COLUMN "triage_key" TEXT;
ALTER TABLE "projects" ADD COLUMN "triage_key_last_used_at" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "projects_triage_key_unique" ON "projects" ("triage_key") WHERE "triage_key" IS NOT NULL;
