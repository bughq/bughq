-- Upload tokens: a project's SECRET credential for build tooling.
--
-- The ingest key is public by design. It ships inside every app bundle, so
-- anyone holding an iPhone can read it. That is fine for POST /errors, which
-- only appends events behind quotas, but symbol uploads REPLACE what the server
-- uses to read every future crash. Uploading with the public key would let
-- anyone with the app swap a release's symbols for garbage, or for names that
-- mislead whoever is triaging. So uploads take a separate credential that lives
-- only in CI (an Xcode Cloud secret, a Gradle env var), never in an app.
--
-- Only the SHA-256 of a token is stored. The plaintext is shown once, when it
-- is created, and `token_prefix` is what the settings page shows afterwards so
-- a person can tell their tokens apart. Revoking sets `revoked_at` rather than
-- deleting the row, so the list still explains which CI secret stopped working.
--
-- Hand-written and additive like 0000000039. Do not add an app/Models/*.ts for
-- this table: a new model regenerates every migration from models and deletes
-- the hand-written ones.
CREATE TABLE IF NOT EXISTS "upload_tokens" (
  "id"           varchar(32)  PRIMARY KEY,
  "project_id"   varchar(255) NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "name"         varchar(120) NOT NULL,
  "token_hash"   char(64)     NOT NULL,
  "token_prefix" varchar(24)  NOT NULL,
  "created_by"   integer,
  "last_used_at" timestamptz,
  "revoked_at"   timestamptz,
  "created_at"   timestamptz  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "upload_tokens_hash_unique" ON "upload_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "upload_tokens_project" ON "upload_tokens" ("project_id");
