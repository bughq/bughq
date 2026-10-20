-- A read-scoped project key, so a machine can read this project's issues
-- without holding a person's credentials (bughq/bughq#19).
--
-- `ingest_key` beside it is public and write-only: it ships in client bundles
-- and only permits writing to one project. This one returns data, so it is a
-- secret, it is compared in constant time (app/Support/read-key.ts), and
-- neither ingest nor the autofix and debug-file endpoints accept it.
--
-- Both columns are nullable because a key is issued on demand rather than at
-- creation, and revoking is setting the column back to NULL — which is also
-- why the uniqueness below is a partial index: every revoked project would
-- otherwise collide on NULL.
--
-- `read_key_last_used_at` exists so somebody can tell whether a key is still
-- in use before revoking it. It is written at most once a minute per key
-- (LAST_USED_RESOLUTION_MS), not on every request.
ALTER TABLE "projects" ADD COLUMN "read_key" TEXT;
ALTER TABLE "projects" ADD COLUMN "read_key_last_used_at" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "projects_read_key_unique" ON "projects" ("read_key") WHERE "read_key" IS NOT NULL;
