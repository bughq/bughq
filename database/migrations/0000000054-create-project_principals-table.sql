-- Project principals: the owner of the tokens that act for a project.
--
-- A Stacks personal access token records its owner's table and numeric id
-- (`tokenable_type`, `tokenable_id`). A project's id is text, so each project
-- gets one row here and the row's id is what its read keys and upload tokens
-- belong to (app/Models/ProjectPrincipal.ts, app/Support/project-tokens.ts).
CREATE TABLE IF NOT EXISTS "project_principals" (
  "id"         SERIAL       PRIMARY KEY,
  "project_id" varchar(255) NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "created_at" timestamptz  NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_principals_project_unique" ON "project_principals" ("project_id");

-- A principal for every project that holds a read key, so the key below has
-- an owner. Other projects get theirs the first time a token is minted.
INSERT INTO "project_principals" ("project_id", "created_at", "updated_at")
SELECT "id", NOW(), NOW() FROM "projects" WHERE "read_key" IS NOT NULL
ON CONFLICT ("project_id") DO NOTHING;

-- Carry each issued read key over as a project token under its current value.
--
-- The key sat in `projects.read_key` in the clear. The framework stores a
-- token as the SHA-256 of its bearer, so writing that digest here makes the
-- very same key a live framework token: whatever holds it keeps reading
-- without being reissued anything. This is the one place a token row is
-- written by hand rather than by `createToken`, because `createToken` chooses
-- the secret and these secrets already exist. The columns are the ones it
-- writes.
INSERT INTO "oauth_access_tokens"
  ("tokenable_type", "tokenable_id", "user_id", "oauth_client_id", "token", "name", "scopes", "revoked", "expires_at", "created_at", "updated_at")
SELECT
  'project_principals',
  pp."id",
  pp."id",
  (SELECT "id" FROM "oauth_clients" WHERE "personal_access_client" = true AND "revoked" = false ORDER BY "id" LIMIT 1),
  encode(sha256(convert_to(p."read_key", 'UTF8')), 'hex'),
  'Read key',
  '["project:read"]',
  false,
  (NOW() AT TIME ZONE 'UTC') + interval '3650 days',
  (NOW() AT TIME ZONE 'UTC'),
  (NOW() AT TIME ZONE 'UTC')
FROM "projects" p
JOIN "project_principals" pp ON pp."project_id" = p."id"
WHERE p."read_key" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "oauth_clients" WHERE "personal_access_client" = true AND "revoked" = false)
  AND NOT EXISTS (
    SELECT 1 FROM "oauth_access_tokens" t
    WHERE t."token" = encode(sha256(convert_to(p."read_key", 'UTF8')), 'hex')
  );

-- The keys now live, hashed, in the framework's token table.
DROP INDEX IF EXISTS "projects_read_key_unique";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "read_key";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "read_key_last_used_at";
